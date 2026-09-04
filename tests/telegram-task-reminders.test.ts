import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planTelegramTaskReminders, type ReminderTask } from '../server/services/telegram-task-reminder-plan';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), connect: vi.fn(), identity: vi.fn(), fetch: vi.fn(), warn: vi.fn(),
  config: { production: true, token: '12345:test-only', secret: 'test-only' },
}));
vi.mock('../server/db', () => ({ pool: { connect: mocks.connect } }));
vi.mock('../server/config', () => ({
  get isProductionEnvironment() { return mocks.config.production; },
  appConfig: { server: { appUrl: 'https://crm.example.test' }, integrations: { telegramTasks: {
    get botToken() { return mocks.config.token; }, get webhookSecret() { return mocks.config.secret; },
  } } },
}));
vi.mock('../server/services/telegram-tasks', () => ({ getTelegramTaskIdentity: mocks.identity }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
import { processTelegramTaskReminders, sendTelegramTaskReminder } from '../server/services/telegram-task-reminders';

const zone = 'Asia/Tashkent';
const morning = new Date('2026-09-04T04:00:00Z');
const task = (id: number, due: string | null, title = 'Позвонить клиенту'): ReminderTask => ({ id, title, due_at: due ? new Date(due) : null });
const recipient = { id: 1, user_id: 7, telegram_user_id: '700', verification_id: 'version-1' };
let tasks: ReminderTask[];
let recipients: typeof recipient[];
type Row = { id: number; status: string; next: Date | null; code: number | null; updated: Date; bindingId: number };
let claims: Map<string, Row>;

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(morning);
  mocks.config.production = true; mocks.config.token = '12345:test-only'; mocks.config.secret = 'test-only';
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  tasks = [task(1, '2026-09-04T10:00:00Z')]; recipients = [{ ...recipient }]; claims = new Map();
  mocks.identity.mockImplementation(async (_bot, chat) => {
    const binding = recipients.find((row) => row.telegram_user_id === chat)!;
    return { user: { id: binding.user_id }, binding: { verification_id: binding.verification_id } };
  });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockImplementation(async (sql: string, args: any[] = []) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [] };
    if (sql.includes('WHERE binding.bot_id = $1 AND reminder.error_code = 429')) {
      return { rows: [...claims.values()].filter((row) => row.code === 429 && row.next && row.next > args[1]) };
    }
    if (sql.includes('FROM telegram_task_bindings binding JOIN users')) {
      expect(sql).toContain('employee.is_active = true AND employee.is_archived = false');
      return { rows: recipients.filter((binding) => ![...claims.values()].some((row) =>
        row.bindingId === binding.id && [400, 403].includes(row.code ?? 0) && row.updated.getTime() > args[1].getTime() - 86_400_000)) };
    }
    if (sql.includes('FROM board_tasks')) {
      expect(sql).toContain("assignee_id = $1 AND status IN ('backlog', 'todo', 'in_progress')");
      return { rows: tasks };
    }
    if (sql.includes('INSERT INTO telegram_task_reminders')) {
      expect(sql).toContain('ON CONFLICT (binding_id, kind, event_key)');
      const key = args.slice(0, 3).join('|');
      let row = claims.get(key);
      if (row && !(row.status === 'deferred' && row.next && row.next <= args[3])) return { rows: [] };
      if (!row) { row = { id: claims.size + 1, status: 'attempted', next: null, code: null, updated: new Date(), bindingId: args[0] }; claims.set(key, row); }
      row.status = 'attempted';
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('UPDATE telegram_task_reminders')) {
      const row = [...claims.values()].find((entry) => entry.id === args[0])!;
      Object.assign(row, { status: args[1], code: args[2], next: args[3], updated: args[4] });
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Telegram reminder schedule and message', () => {
  it('uses the academy day rather than UTC and catches up only during the 09:00 hour', () => {
    const entries = [task(1, '2026-09-03T19:30:00Z'), task(2, '2026-09-04T18:59:00Z'), task(3, '2026-09-04T19:00:00Z'), task(4, null)];
    const [daily] = planTelegramTaskReminders(entries, morning, zone);
    expect(daily.eventKey).toBe('2026-09-04');
    expect(daily.text).toContain('На сегодня: 1. Просрочено: 1. Без срока: 1.');
    expect(daily.text).toContain('#1'); expect(daily.text).toContain('#2'); expect(daily.text).not.toContain('#3');
    expect(planTelegramTaskReminders(entries, new Date('2026-09-04T03:59:00Z'), zone)).toEqual([]);
    expect(planTelegramTaskReminders(entries, new Date('2026-09-04T04:59:00Z'), zone)[0].kind).toBe('daily');
    expect(planTelegramTaskReminders(entries, new Date('2026-09-04T05:00:00Z'), zone)).toEqual([]);
  });
  it('reminds within the last hour, excludes expired deadlines and changes keys after rescheduling', () => {
    const now = new Date('2026-09-04T10:00:00Z');
    const entries = [task(1, '2026-09-04T10:00:00Z'), task(2, '2026-09-04T10:00:01Z'), task(3, '2026-09-04T11:00:00Z'), task(4, '2026-09-04T11:00:01Z'), task(5, null)];
    const planned = planTelegramTaskReminders(entries, now, zone);
    expect(planned).toHaveLength(2);
    expect(planned[0].text).toContain('1 мин.'); expect(planned[1].text).toContain('60 мин.');
    expect(planTelegramTaskReminders([task(2, '2026-09-04T10:30:00Z')], now, zone)[0].eventKey).not.toBe(planned[0].eventKey);
    expect(planTelegramTaskReminders([], morning, zone)).toEqual([]);
  });
  it('bounds large digests, including emoji titles, and keeps English translations available', () => {
    const planned = planTelegramTaskReminders(Array.from({ length: 100 }, (_, i) => task(i, null, '😀'.repeat(255))), morning, zone, 'en')[0];
    expect(planned.text.length).toBeLessThan(4096);
    expect(planned.text).toContain('92 more tasks'); expect(planned.text).toContain('Your tasks');
  });
});

describe('Telegram reminder delivery', () => {
  it('sends to the verified employee with a Mini App button and no parse mode', async () => {
    expect(await processTelegramTaskReminders(zone, morning)).toBe(1);
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(payload.chat_id).toBe('700'); expect(payload.parse_mode).toBeUndefined();
    expect(payload.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://crm.example.test/miniapp/tasks');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('persists claims across repeated worker invocations and next day uses a new key', async () => {
    await processTelegramTaskReminders(zone, morning); await processTelegramTaskReminders(zone, morning);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await processTelegramTaskReminders(zone, new Date('2026-09-05T04:00:00Z'));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('does not notify outside production or without bot configuration', async () => {
    mocks.config.production = false; await processTelegramTaskReminders(zone);
    mocks.config.production = true; mocks.config.token = ''; await processTelegramTaskReminders(zone);
    expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('skips archived, ambiguous, unlinked, or rebound identities rejected by the existing identity check', async () => {
    mocks.identity.mockResolvedValue(null); await processTelegramTaskReminders(zone, morning);
    mocks.identity.mockResolvedValue({ user: { id: 8 }, binding: { verification_id: 'version-1' } }); await processTelegramTaskReminders(zone, morning);
    mocks.identity.mockResolvedValue({ user: { id: 7 }, binding: { verification_id: 'new-version' } }); await processTelegramTaskReminders(zone, morning);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(claims.size).toBe(0);
  });
  it('does not send when another instance owns the lock', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
    expect(await processTelegramTaskReminders(zone, morning)).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('waits for retry_after bot-wide, then retries a confirmed 429 safely', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 120 } }) });
    await processTelegramTaskReminders(zone, morning);
    await processTelegramTaskReminders(zone, new Date(morning.getTime() + 60_000));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(await processTelegramTaskReminders(zone, new Date(morning.getTime() + 120_000))).toBe(1);
  });
  it('re-evaluates reassigned, completed, deleted and rescheduled tasks before a deferred retry', async () => {
    vi.setSystemTime('2026-09-04T10:00:00Z'); tasks = [task(1, '2026-09-04T10:30:00Z')];
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 60 } }) });
    await processTelegramTaskReminders(zone);
    vi.setSystemTime('2026-09-04T10:02:00Z'); tasks = [];
    await processTelegramTaskReminders(zone);
    tasks = [task(1, '2026-09-04T12:00:00Z')]; await processTelegramTaskReminders(zone);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry an ambiguous timeout or leak tokens and titles into logs', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('https://api.telegram.org/bot12345:test-only/sendMessage sensitive-title'));
    await processTelegramTaskReminders(zone, morning); await processTelegramTaskReminders(zone, morning);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect([...claims.values()][0].status).toBe('uncertain');
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/test-only|sensitive-title|Позвонить/);
  });
  it('does not retry a persisted attempted claim after a crash', async () => {
    claims.set('1|daily|2026-09-04', { id: 1, bindingId: 1, status: 'attempted', next: null, code: null, updated: morning });
    await processTelegramTaskReminders(zone, morning); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('suppresses blocked chats instead of retrying every minute', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ ok: false, error_code: 403 }) });
    tasks.push(task(2, '2026-09-04T04:30:00Z'));
    await processTelegramTaskReminders(zone, morning); await processTelegramTaskReminders(zone, morning);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('sends at most one reminder per recipient per tick', async () => {
    tasks = [task(1, '2026-09-04T04:30:00Z'), task(2, '2026-09-04T04:45:00Z')];
    await processTelegramTaskReminders(zone, morning); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await processTelegramTaskReminders(zone, morning); expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('destroys a connection if unlocking fails', async () => {
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql, args) => {
      if (sql.includes('pg_advisory_unlock')) throw new Error('connection lost');
      return original(sql, args);
    });
    await processTelegramTaskReminders(zone, morning);
    expect(mocks.release).toHaveBeenCalledWith(true);
  });
  it('treats malformed or 5xx responses as uncertain rather than infinitely retrying', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ ok: false }) });
    expect((await sendTelegramTaskReminder('test-only', '700', 'text', 'https://crm.example.test/miniapp/tasks')).status).toBe('uncertain');
    mocks.fetch.mockResolvedValueOnce({ json: async () => { throw new Error('invalid JSON'); } });
    expect((await sendTelegramTaskReminder('test-only', '700', 'text', 'https://crm.example.test/miniapp/tasks')).status).toBe('uncertain');
  });
});

it('registers a non-destructive delivery-history migration after source restoration', () => {
  const migration = readFileSync(new URL('../migrations/0103_telegram_task_reminders.sql', import.meta.url), 'utf8');
  expect(migration).toContain('UNIQUE (binding_id, kind, event_key)');
  expect(migration).toContain('REFERENCES telegram_task_bindings(id) ON DELETE CASCADE');
  expect(migration).not.toMatch(/(?:^|;)\s*(?:DROP|DELETE|UPDATE)\b/m);
  const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'));
  expect(journal.entries.at(-1)).toMatchObject({ idx: 103, tag: '0103_telegram_task_reminders' });
});
