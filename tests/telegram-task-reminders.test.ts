import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planTelegramTaskReminders, planTelegramWeeklyDigest, weekKeys, type ReminderTask } from '../server/services/telegram-task-reminder-plan';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), connect: vi.fn(), identity: vi.fn(), fetch: vi.fn(), warn: vi.fn(),
  config: { production: true, token: '12345:test-only', secret: 'test-only' },
}));
vi.mock('../server/db', () => ({ pool: { connect: mocks.connect, query: mocks.query } }));
vi.mock('../server/config', () => ({
  get isProductionEnvironment() { return mocks.config.production; },
  appConfig: { server: { appUrl: 'https://crm.example.test' }, integrations: { telegramTasks: {
    get botToken() { return mocks.config.token; }, get webhookSecret() { return mocks.config.secret; },
  } } },
}));
vi.mock('../server/services/telegram-tasks', () => ({ getTelegramTaskIdentity: mocks.identity }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
import { notifyTelegramTaskProgress, processTelegramTaskReminders, sendTelegramTaskReminder } from '../server/services/telegram-task-reminders';

const zone = 'Asia/Tashkent';
const morning = new Date('2026-09-04T04:00:00Z');
const task = (id: number, due: string | null, title = 'Позвонить клиенту'): ReminderTask => ({ id, title, due_at: due ? new Date(due) : null, status: 'todo' });
const recipient = { id: 1, user_id: 7, telegram_user_id: '700', verification_id: 'version-1' };
let tasks: ReminderTask[];
let teamTasks: ReminderTask[];
let recipients: typeof recipient[];
type Row = { id: number; status: string; next: Date | null; code: number | null; updated: Date; bindingId: number };
let claims: Map<string, Row>;

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(morning);
  mocks.config.production = true; mocks.config.token = '12345:test-only'; mocks.config.secret = 'test-only';
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  tasks = [task(1, '2026-09-04T10:00:00Z')]; teamTasks = []; recipients = [{ ...recipient }]; claims = new Map();
  mocks.identity.mockImplementation(async (_bot, chat) => {
    const binding = recipients.find((row) => row.telegram_user_id === chat)!;
    return { user: { id: binding.user_id, module: 'sales', modules: ['sales'] }, binding: { verification_id: binding.verification_id } };
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
    if (sql.includes('FROM board_tasks task')) {
      expect(sql).toContain('task.assignee_id <> $1');
      expect(sql).toContain('employee.is_active = true AND employee.is_archived = false');
      return { rows: teamTasks };
    }
    if (sql.includes('FROM board_tasks')) {
      expect(sql).toContain("assignee_id = $1 AND status <> 'accepted'");
      return { rows: tasks };
    }
    if (sql.includes('SELECT status FROM telegram_task_reminders')) {
      const row = claims.get(args.join('|'));
      return { rows: row ? [{ status: row.status }] : [] };
    }
    if (sql.includes('SELECT telegram_user_id, verification_id FROM telegram_task_bindings')) {
      return { rows: args[1] === 7 ? [{ telegram_user_id: '700', verification_id: 'version-1' }] : [] };
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
  it('groups the academy week from Monday to Sunday and sends during the 09:00 hour', () => {
    const entries = [task(1, '2026-08-30T18:59:00Z', 'Просроченная'), task(2, '2026-09-03T19:30:00Z', 'Четверг'), task(3, '2026-09-04T19:00:00Z', 'Суббота'), task(4, null), task(5, '2026-09-06T19:00:00Z', 'Следующая неделя')];
    const [daily] = planTelegramWeeklyDigest(entries, morning, zone);
    expect(weekKeys(morning, zone)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(daily.eventKey).toBe('2026-09-04');
    expect(daily.text).toContain('Просроченная');
    expect(daily.text).toContain('Четверг');
    expect(daily.text).toContain('Суббота');
    expect(daily.text).toContain('Задачи без срока');
    expect(daily.text).not.toContain('Следующая неделя');
    expect(planTelegramWeeklyDigest(entries, new Date('2026-09-04T03:59:00Z'), zone)).toEqual([]);
    expect(planTelegramWeeklyDigest(entries, new Date('2026-09-04T04:59:00Z'), zone)[0].kind).toBe('daily');
    expect(planTelegramWeeklyDigest(entries, new Date('2026-09-04T05:00:00Z'), zone)).toEqual([]);
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
  it('splits long digests without dropping tasks and keeps English translations available', () => {
    const planned = planTelegramWeeklyDigest(Array.from({ length: 100 }, (_, i) => task(i, null, `Task ${i} ` + '😀'.repeat(255))), morning, zone, 'own', 'en');
    expect(planned.length).toBeGreaterThan(1);
    expect(planned.every((entry) => entry.text.length < 4096)).toBe(true);
    expect(planned.map((entry) => entry.text).join('\n')).toContain('Task 99');
    expect(planned[0].text).toContain('Your tasks');
    expect(planTelegramWeeklyDigest([], morning, zone)[0].text).toContain('Задач на эту неделю нет');
  });
  it('marks completed tasks awaiting acceptance and groups team tasks by day', () => {
    const own = planTelegramWeeklyDigest([
      { ...task(1, '2026-09-04T06:00:00Z', 'Готовый отчёт'), status: 'done' },
      { ...task(4, '2026-08-29T06:00:00Z', 'Старый готовый отчёт'), status: 'done' },
    ], morning, zone);
    expect(own[0].text).toContain('Готовый отчёт — 11:00 (выполнена)');
    expect(own[0].text).not.toContain('Старый готовый отчёт');
    const team = planTelegramWeeklyDigest([
      { ...task(2, '2026-09-05T06:00:00Z', 'Проверить оплату'), assignee_name: 'Алина' },
      { ...task(3, '2026-09-06T06:00:00Z', 'Подготовить план'), assignee_name: 'Боб' },
    ], morning, zone, 'team');
    expect(team[0].text).toContain('Алина: Проверить оплату');
    expect(team[0].text).toContain('Боб: Подготовить план');
    expect(team[0].eventKey).toBe('2026-09-04:team:0');
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
  it('sends an administrator personal tasks first, followed by other active employees', async () => {
    teamTasks = [
      { ...task(10, '2026-09-05T08:00:00Z', 'Отчёт отдела'), assignee_name: 'Алина' },
      { ...task(11, '2026-09-06T08:00:00Z', 'План отдела'), assignee_name: 'Боб' },
    ];
    mocks.identity.mockResolvedValue({ user: { id: 7, module: 'sales', modules: ['sales', 'administration'] }, binding: { verification_id: 'version-1' } });
    expect(await processTelegramTaskReminders(zone, morning)).toBe(2);
    const messages = mocks.fetch.mock.calls.map((call) => JSON.parse(call[1].body).text);
    expect(messages[0]).toContain('Ваши задачи на неделю');
    expect(messages[0]).toContain('Позвонить клиенту');
    expect(messages[1]).toContain('Задачи сотрудников на неделю');
    expect(messages[1]).toContain('Алина: Отчёт отдела');
    expect(messages[1]).toContain('Боб: План отдела');
    expect(messages[1]).not.toContain('Позвонить клиенту');
    await processTelegramTaskReminders(zone, morning);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('never reads team tasks for a non-administrator', async () => {
    await processTelegramTaskReminders(zone, morning);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('FROM board_tasks task'))).toBe(false);
  });
  it('does not send a team section after an uncertain personal delivery', async () => {
    teamTasks = [{ ...task(10, '2026-09-05T08:00:00Z', 'Отчёт отдела'), assignee_name: 'Алина' }];
    mocks.identity.mockResolvedValue({ user: { id: 7, module: 'administration', modules: ['administration'] }, binding: { verification_id: 'version-1' } });
    mocks.fetch.mockRejectedValueOnce(new Error('timeout'));
    await processTelegramTaskReminders(zone, morning);
    await processTelegramTaskReminders(zone, morning);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect([...claims.values()][0].status).toBe('uncertain');
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
  it('sends the weekly digest before deadline reminders', async () => {
    tasks = [task(1, '2026-09-04T04:30:00Z'), task(2, '2026-09-04T04:45:00Z')];
    await processTelegramTaskReminders(zone, morning); expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).text).toContain('Ваши задачи на неделю');
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).text).toContain('До срока задачи');
    await processTelegramTaskReminders(zone, morning); expect(mocks.fetch).toHaveBeenCalledTimes(3);
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

describe('Delegated task progress notification', () => {
  const event = { title: 'Подготовить\nдокументы', creatorId: 7, assigneeId: 8, actorId: 8, actorName: 'Алина', status: 'in_progress' as const };

  it('sends a plain private message to the verified creator when work starts or completes', async () => {
    expect(await notifyTelegramTaskProgress(event)).toBe(true);
    const started = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(started.chat_id).toBe('700');
    expect(started.text).toContain('Задача в работе\nПодготовить документы\nИсполнитель: Алина');
    expect(started.parse_mode).toBeUndefined();
    expect(started.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://crm.example.test/miniapp/tasks');
    expect(await notifyTelegramTaskProgress({ ...event, status: 'done' })).toBe(true);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).text).toContain('Задача отмечена выполненной');
  });

  it('does not send for self-assigned tasks, another actor or an invalid binding', async () => {
    expect(await notifyTelegramTaskProgress({ ...event, creatorId: 8 })).toBe(false);
    expect(await notifyTelegramTaskProgress({ ...event, actorId: 1 })).toBe(false);
    mocks.identity.mockResolvedValue(null);
    expect(await notifyTelegramTaskProgress(event)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not use copied bot settings outside production', async () => {
    mocks.config.production = false;
    expect(await notifyTelegramTaskProgress(event)).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

it('registers a non-destructive delivery-history migration after source restoration', () => {
  const migration = readFileSync(new URL('../migrations/0103_telegram_task_reminders.sql', import.meta.url), 'utf8');
  expect(migration).toContain('UNIQUE (binding_id, kind, event_key)');
  expect(migration).toContain('REFERENCES telegram_task_bindings(id) ON DELETE CASCADE');
  expect(migration).not.toMatch(/(?:^|;)\s*(?:DROP|DELETE|UPDATE)\b/m);
  const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'));
  expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 103, tag: '0103_telegram_task_reminders' }));
});
