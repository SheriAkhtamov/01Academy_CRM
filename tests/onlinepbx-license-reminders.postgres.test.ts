import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlinePbxLicense } from '../server/services/onlinepbx';

const mocks = vi.hoisted(() => ({
  pool: null as Pool | null,
  db: null as ReturnType<typeof drizzle> | null,
  production: true,
  recipients: [7] as number[],
  requiredExtensions: [] as string[],
  identity: vi.fn(),
  licenses: vi.fn(),
  extensions: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('../server/db', () => ({ get pool() { return mocks.pool; }, get db() { return mocks.db; } }));
vi.mock('../server/config', () => ({
  get isProductionEnvironment() { return mocks.production; },
  appConfig: { server: { appUrl: 'https://crm.example.test' }, integrations: {
    telegramTasks: { botToken: '12345:test-only', webhookSecret: 'test-only' },
    onlinePbx: { get licenseReminderUserIds() { return mocks.recipients; }, get licenseRequiredExtensions() { return mocks.requiredExtensions; } },
  } },
}));
vi.mock('../server/services/onlinepbx', () => ({ onlinePbxClient: {
  isConfigured: () => true, getDomain: () => 'example.onpbx.ru', listLicenses: mocks.licenses, listExtensions: mocks.extensions,
} }));
vi.mock('../server/services/telegram-tasks', () => ({ getTelegramTaskIdentity: mocks.identity }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
import { processOnlinePbxLicenseReminders } from '../server/services/onlinepbx-license-reminders';
import { ensureOnlinePbxLicenseTask } from '../server/storage/onlinepbx-license-tasks';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `pbx_reminders_${randomUUID().replace(/-/g, '')}`;
const zone = 'Asia/Tashkent';
const morning = new Date('2026-11-15T04:00:00Z');
const license: OnlinePbxLicense = { startStamp: 1792750360, endStamp: 1795294799, serviceType: 'USER', serviceCount: 1 };

describe.skipIf(!url)('OnlinePBX reminders with a persistent delivery ledger', () => {
  let admin: Pool;
  let pool: Pool;
  const run = (now = new Date()) => processOnlinePbxLicenseReminders(zone, now);
  const deliveries = async () => (await pool.query("SELECT * FROM telegram_task_reminders WHERE kind = 'onlinepbx_license' ORDER BY id")).rows;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    mocks.pool = pool;
    mocks.db = drizzle(pool);
    await pool.query(`
      CREATE TABLE users (id integer PRIMARY KEY, module text DEFAULT 'sales', is_active boolean DEFAULT true, is_archived boolean DEFAULT false);
      CREATE TABLE user_modules (user_id integer, module text);
      CREATE TABLE boards (id serial PRIMARY KEY, is_default boolean DEFAULT true, is_archived boolean DEFAULT false);
      CREATE TABLE board_tasks (id serial PRIMARY KEY, board_id integer REFERENCES boards(id), title varchar(255) NOT NULL,
        description text, status varchar(20) DEFAULT 'backlog', priority varchar(10) DEFAULT 'normal', color varchar(20),
        position integer DEFAULT 0, creator_id integer REFERENCES users(id), assignee_id integer REFERENCES users(id),
        lead_id integer, legacy_academy_task_id integer, telephony_call_id integer, due_at timestamp,
        accepted_at timestamp, accepted_by integer, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      CREATE TABLE board_task_activity (id serial PRIMARY KEY, task_id integer REFERENCES board_tasks(id) ON DELETE CASCADE,
        actor_id integer, type varchar(40), from_value varchar(120), to_value varchar(120), meta jsonb, created_at timestamp DEFAULT now());
      CREATE TABLE telegram_task_bindings (id serial PRIMARY KEY, bot_id text, user_id integer REFERENCES users(id),
        telegram_user_id text, verification_id text);
    `);
    await pool.query(readFileSync('migrations/0103_telegram_task_reminders.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0158_telegram_task_events.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0165_onlinepbx_license_reminders.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0166_onlinepbx_license_issues.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0167_onlinepbx_license_periods.sql', 'utf8'));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(morning);
    mocks.production = true;
    mocks.recipients = [7];
    mocks.requiredExtensions = [];
    mocks.extensions.mockResolvedValue([
      { extension: '100', name: 'Main', enabled: true, registered: true },
      { extension: '101', name: 'Second', enabled: false, registered: false },
    ]);
    mocks.licenses.mockResolvedValue([license]);
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    mocks.identity.mockImplementation(async (_bot, chat) => ({ user: { id: Number(chat) }, binding: { verification_id: 'v1' } }));
    await pool.query('TRUNCATE users, boards, board_tasks, board_task_activity, onlinepbx_license_tasks, onlinepbx_license_periods, telegram_task_bindings, telegram_task_reminders, telegram_task_events RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO users (id,module) VALUES (1,'administration'),(7,'sales'),(8,'sales'); INSERT INTO boards(id) VALUES(1); INSERT INTO telegram_task_bindings (bot_id,user_id,telegram_user_id,verification_id) VALUES ('12345',7,'7','v1'),('12345',8,'8','v1')");
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('sends only to selected employees, once across concurrent workers and repeated runs', async () => {
    expect((await Promise.all([run(), run()])).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await run()).toBe(0);
    expect(await deliveries()).toMatchObject([{ binding_id: 1, status: 'sent' }]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe('7');
    expect(body.text).toContain('22.11.2026, 01:59');
    expect(body.reply_markup.inline_keyboard).toEqual([[{ text: 'Открыть задачу', web_app: { url: 'https://crm.example.test/miniapp/tasks?view=mine&task=1' } }]]);
    const tasks = (await pool.query('SELECT assignee_id,creator_id,title,due_at::text FROM board_tasks')).rows;
    expect(tasks).toMatchObject([{ assignee_id: 7, creator_id: 1, title: 'Оплатить продление лицензий OnlinePBX — example.onpbx.ru', due_at: '2026-11-21 20:59:59' }]);
  });

  it('stores dates silently without a recipient or before 09:00, but never runs outside production', async () => {
    mocks.recipients = [];
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT end_stamp FROM onlinepbx_license_periods')).rows).toEqual([{ end_stamp: '1795294799' }]);
    mocks.recipients = [7]; mocks.production = false;
    mocks.licenses.mockClear();
    expect(await run()).toBe(0);
    expect(mocks.licenses).not.toHaveBeenCalled();
    mocks.production = true;
    expect(await run(new Date('2026-11-15T03:59:59Z'))).toBe(0);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(0);
    await pool.query("UPDATE telegram_task_bindings SET bot_id = 'other'");
    expect(await run()).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('revalidates phone bindings and excludes archived or disabled employees', async () => {
    mocks.identity.mockResolvedValueOnce({ user: { id: 7 }, binding: { verification_id: 'rebound' } });
    expect(await run()).toBe(0);
    await pool.query('UPDATE users SET is_archived = true WHERE id = 7');
    expect(await run()).toBe(0);
    await pool.query('UPDATE users SET is_archived = false, is_active = false WHERE id = 7');
    expect(await run()).toBe(0);
    expect(await deliveries()).toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not repeat reminders at 3/1 days and completes the task when a full continuation is paid', async () => {
    expect(await run()).toBe(1);
    vi.setSystemTime(new Date('2026-11-19T04:00:00Z'));
    expect(await run()).toBe(0);
    expect(await run()).toBe(0);
    vi.setSystemTime(new Date('2026-11-21T04:00:00Z'));
    mocks.licenses.mockResolvedValue([license, { ...license, startStamp: license.endStamp + 1, endStamp: license.endStamp + 2592000 }]);
    expect(await run()).toBe(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT status FROM board_tasks')).rows).toEqual([{ status: 'done' }]);
    expect((await pool.query("SELECT payload FROM telegram_task_events WHERE payload->>'kind'='done'")).rows).toHaveLength(1);
  });

  it('retries explicit rate limits only after the shared cooldown, then persists success', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 429,
      json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 60 } }) });
    expect(await run()).toBe(0);
    expect(await deliveries()).toMatchObject([{ status: 'deferred', error_code: 429 }]);
    vi.setSystemTime(new Date(morning.getTime() + 30_000));
    expect(await run()).toBe(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(morning.getTime() + 61_000));
    expect(await run()).toBe(1);
    expect(await deliveries()).toMatchObject([{ status: 'sent', error_code: null }]);
    expect(await run()).toBe(0);
  });

  it('creates the task during a bot cooldown while deferring Telegram delivery', async () => {
    await pool.query(`INSERT INTO telegram_task_events (recipient_id,event_key,payload,status,next_attempt_at)
      VALUES (7,'task-cooldown','{}','deferred',$1)`, [new Date(morning.getTime() + 60_000)]);
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('retains ambiguous deliveries without blindly resending and retries a failed billing read safely', async () => {
    mocks.licenses.mockRejectedValueOnce(new Error('billing unavailable'));
    await expect(run()).rejects.toThrow('billing unavailable');
    expect(await deliveries()).toEqual([]);
    mocks.fetch.mockRejectedValueOnce(new Error('network timeout'));
    expect(await run()).toBe(0);
    expect(await deliveries()).toMatchObject([{ status: 'uncertain' }]);
    expect(await run()).toBe(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a blocked bot or a claim left attempted by an interrupted process', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ ok: false, error_code: 403 }) });
    expect(await run()).toBe(0);
    expect(await run()).toBe(0);
    expect(await deliveries()).toMatchObject([{ status: 'failed', error_code: 403 }]);
    await pool.query("UPDATE telegram_task_reminders SET status='attempted'");
    expect(await run()).toBe(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('creates a CRM task before the recipient connects Telegram and delivers once the binding is verified', async () => {
    await pool.query('DELETE FROM telegram_task_bindings WHERE user_id=7');
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT assignee_id FROM board_tasks')).rows).toEqual([{ assignee_id: 7 }]);
    await pool.query("INSERT INTO telegram_task_bindings (bot_id,user_id,telegram_user_id,verification_id) VALUES ('12345',7,'7','v1')");
    expect(await run()).toBe(1);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(1);
  });

  it('stops payment reminders for completed, reassigned or deleted tasks without recreating them', async () => {
    expect(await run()).toBe(1);
    vi.setSystemTime(new Date('2026-11-19T04:00:00Z'));
    await pool.query("UPDATE board_tasks SET status='done'");
    expect(await run()).toBe(0);
    await pool.query("UPDATE board_tasks SET status='todo',assignee_id=8");
    expect(await run()).toBe(0);
    await pool.query('DELETE FROM board_tasks');
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT task_id FROM onlinepbx_license_tasks')).rows).toEqual([{ task_id: null }]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('atomically deduplicates task creation even without the scheduler lock', async () => {
    const input = { domain: 'example.onpbx.ru', endStamp: license.endStamp, userId: 7, title: 'Оплатить OnlinePBX', description: 'Продлить лицензии' };
    const results = await Promise.all([ensureOnlinePbxLicenseTask(input), ensureOnlinePbxLicenseTask(input)]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(results[0].task?.id).toBe(results[1].task?.id);
    expect((await pool.query('SELECT id FROM board_task_activity')).rows).toHaveLength(1);
  });

  it('creates a separate task for an already expired 101 while 100 has a valid license, even at night', async () => {
    mocks.requiredExtensions = ['100', '101'];
    vi.setSystemTime(new Date('2026-10-24T19:30:00Z'));
    expect(await run()).toBe(0);
    expect(await run()).toBe(0);
    const tasks = (await pool.query('SELECT title,assignee_id,priority,due_at FROM board_tasks')).rows;
    expect(tasks).toEqual([{ title: 'Оплатить лицензию и включить OnlinePBX №101', assignee_id: 7, priority: 'urgent', due_at: null }]);
    const issues = (await pool.query('SELECT extension,task_id,resolved_at FROM onlinepbx_license_issues')).rows;
    expect(issues).toMatchObject([{ extension: '101', task_id: 1, resolved_at: null }]);
    expect((await pool.query('SELECT recipient_id,payload FROM telegram_task_events')).rows).toMatchObject([
      { recipient_id: 7, payload: { kind: 'created', taskId: 1 } },
    ]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not label a manually disabled user as unlicensed when two seats are paid', async () => {
    mocks.requiredExtensions = ['100', '101'];
    mocks.licenses.mockResolvedValue([{ ...license, serviceCount: 2 }]);
    vi.setSystemTime(new Date('2026-10-24T19:30:00Z'));
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(0);
  });

  it('retains one issue until recovery, and creates a new task after another real license outage', async () => {
    mocks.requiredExtensions = ['100', '101'];
    vi.setSystemTime(new Date('2026-10-24T19:30:00Z'));
    await run();
    mocks.extensions.mockResolvedValue([{ extension: '100', name: 'Main', enabled: true, registered: true }]);
    await run();
    expect((await pool.query('SELECT resolved_at FROM onlinepbx_license_issues')).rows[0].resolved_at).toBeNull();
    mocks.extensions.mockResolvedValue([
      { extension: '100', name: 'Main', enabled: true, registered: true },
      { extension: '101', name: 'Second', enabled: true, registered: true },
    ]);
    await run();
    expect((await pool.query('SELECT resolved_at FROM onlinepbx_license_issues')).rows[0].resolved_at).not.toBeNull();
    mocks.extensions.mockResolvedValue([
      { extension: '100', name: 'Main', enabled: true, registered: true },
      { extension: '101', name: 'Second', enabled: false, registered: false },
    ]);
    await run();
    await run();
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(2);
    expect((await pool.query('SELECT id FROM telegram_task_events')).rows).toHaveLength(2);
  });

  it('adopts the existing 101 task and respects deletion without recreating it', async () => {
    mocks.requiredExtensions = ['100', '101'];
    vi.setSystemTime(new Date('2026-10-24T19:30:00Z'));
    await pool.query("INSERT INTO board_tasks(board_id,title,creator_id,assignee_id,status) VALUES (1,'Оплатить №101',1,7,'todo')");
    await pool.query(`INSERT INTO board_task_activity(task_id,actor_id,type,meta)
      VALUES (1,1,'created','{"requestKey":"onlinepbx-license-activation:example.onpbx.ru:101"}')`);
    await run();
    expect((await pool.query('SELECT task_id FROM onlinepbx_license_issues')).rows).toEqual([{ task_id: 1 }]);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM telegram_task_events')).rows).toHaveLength(0);
    await pool.query('DELETE FROM board_tasks');
    await run();
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(0);
  });

  it('keeps expiration history after licenses disappear and refreshes the current paid deadline', async () => {
    mocks.recipients = [];
    vi.setSystemTime(new Date('2026-10-24T19:30:00Z'));
    await run();
    vi.setSystemTime(new Date('2026-10-25T19:30:00Z'));
    const renewed = { ...license, endStamp: license.endStamp + 2592000 };
    mocks.licenses.mockResolvedValue([renewed]);
    await run();
    let periods = (await pool.query('SELECT end_stamp,is_current,first_seen_at::text,last_seen_at::text FROM onlinepbx_license_periods ORDER BY end_stamp')).rows;
    expect(periods).toEqual([
      { end_stamp: String(license.endStamp), is_current: false, first_seen_at: '2026-10-24 19:30:00', last_seen_at: '2026-10-24 19:30:00' },
      { end_stamp: String(renewed.endStamp), is_current: true, first_seen_at: '2026-10-25 19:30:00', last_seen_at: '2026-10-25 19:30:00' },
    ]);
    vi.setSystemTime(new Date((renewed.endStamp + 86400) * 1000));
    mocks.licenses.mockResolvedValue([]);
    await run();
    periods = (await pool.query('SELECT end_stamp,is_current FROM onlinepbx_license_periods ORDER BY end_stamp')).rows;
    expect(periods).toEqual([{ end_stamp: String(license.endStamp), is_current: false }, { end_stamp: String(renewed.endStamp), is_current: false }]);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(0);
  });

  it('updates a changed expiration, completes the old task once, then schedules only the new seven-day window', async () => {
    expect(await run()).toBe(1);
    const renewed = { ...license, endStamp: license.endStamp + 2592000 };
    mocks.licenses.mockResolvedValue([renewed]);
    expect(await run()).toBe(0);
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT status FROM board_tasks ORDER BY id')).rows).toEqual([{ status: 'done' }]);
    expect((await pool.query("SELECT id FROM board_task_activity WHERE meta->>'source'='onlinepbx_renewed'")).rows).toHaveLength(1);
    expect((await pool.query('SELECT end_stamp FROM onlinepbx_license_periods WHERE is_current=true')).rows).toEqual([{ end_stamp: String(renewed.endStamp) }]);
    vi.setSystemTime(new Date((renewed.endStamp - 8 * 86400) * 1000 + 8 * 3600 * 1000));
    expect(await run()).toBe(0);
    vi.setSystemTime(new Date((renewed.endStamp - 7 * 86400) * 1000 + 8 * 3600 * 1000));
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT status FROM board_tasks ORDER BY id')).rows).toEqual([{ status: 'done' }, { status: 'todo' }]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not close a payment task for a partial renewal or a billing error', async () => {
    mocks.licenses.mockResolvedValue([{ ...license, serviceCount: 2 }]);
    await run();
    mocks.licenses.mockResolvedValue([{ ...license, serviceCount: 2 }, { ...license, startStamp: license.endStamp + 1, endStamp: license.endStamp + 2592000 }]);
    await run();
    expect((await pool.query('SELECT status FROM board_tasks')).rows).toEqual([{ status: 'todo' }]);
    const saved = (await pool.query('SELECT end_stamp,is_current,last_seen_at::text FROM onlinepbx_license_periods ORDER BY end_stamp')).rows;
    mocks.licenses.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(run()).rejects.toThrow('provider unavailable');
    expect((await pool.query('SELECT end_stamp,is_current,last_seen_at::text FROM onlinepbx_license_periods ORDER BY end_stamp')).rows).toEqual(saved);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(1);
  });

  it('aggregates matching paid periods without duplicate history and preserves the first observation', async () => {
    mocks.licenses.mockResolvedValue([license, { ...license, serviceCount: 2 }]);
    await run();
    vi.setSystemTime(new Date(morning.getTime() + 3600000));
    await run();
    const rows = (await pool.query('SELECT service_count,first_seen_at::text,last_seen_at::text FROM onlinepbx_license_periods')).rows;
    expect(rows).toEqual([{ service_count: 3, first_seen_at: '2026-11-15 04:00:00', last_seen_at: '2026-11-15 05:00:00' }]);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(1);
  });

  it('stores dates while another task reminder sender owns its delivery lock', async () => {
    const lock = await pool.connect();
    await lock.query("SELECT pg_advisory_lock(hashtext('telegram-task-reminders:12345'))");
    try {
      expect(await run()).toBe(0);
      expect((await pool.query('SELECT end_stamp FROM onlinepbx_license_periods')).rows).toHaveLength(1);
      expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(1);
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext('telegram-task-reminders:12345'))");
      lock.release();
    }
    expect(await run()).toBe(1);
  });

  it('does not restore a premature deleted task now, but enables the newly requested seven-day schedule', async () => {
    const early = new Date('2026-10-25T04:00:00Z');
    await ensureOnlinePbxLicenseTask({ domain: 'example.onpbx.ru', endStamp: license.endStamp, userId: 7,
      title: 'Слишком ранняя задача', description: 'Удалена до окна напоминания' }, early);
    await pool.query('DELETE FROM board_tasks');
    vi.setSystemTime(early);
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(0);
    vi.setSystemTime(morning);
    expect(await run()).toBe(1);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(1);
    await pool.query('DELETE FROM board_tasks');
    expect(await run()).toBe(0);
    expect((await pool.query('SELECT id FROM board_tasks')).rows).toHaveLength(0);
  });
});
