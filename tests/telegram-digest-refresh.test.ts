import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTelegramWeeklyDigest } from '../server/services/telegram-task-reminder-plan';

const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), identity: vi.fn(), fetch: vi.fn(), send: vi.fn(), production: true }));
vi.mock('../server/db', () => ({ pool: { connect: async () => ({ query: mock.query, release: mock.release }) } }));
vi.mock('../server/config', () => ({
  get isProductionEnvironment() { return mock.production; },
  appConfig: { server: { appUrl: 'https://crm.example.test' }, integrations: { telegramTasks: { botToken: '12345:test-only', webhookSecret: 'test-only' } } },
}));
vi.mock('../server/services/telegram-tasks', () => ({ getTelegramTaskIdentity: mock.identity }));
vi.mock('../server/services/telegram-task-delivery', () => ({ sendTelegramTaskReminder: mock.send }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
import { identifyTelegramDigestReply, isTelegramDigestRefreshCommand, refreshTelegramDigest } from '../server/services/telegram-digest-refresh';

const now = new Date('2026-10-20T09:00:00Z');
const source = { message_id: 70, date: Date.parse('2026-10-20T04:00:00Z') / 1000,
  chat: { id: 700, type: 'private' }, from: { id: 12345, is_bot: true }, text: '👥 Задачи сотрудников на неделю (19.10–25.10)\nСтарые задачи' };
const request = () => ({ botId: '12345', telegramUserId: '700', source: structuredClone(source), language: 'ru' as const });
let claimStatus: string | null;
let entries: Array<{ id: number; title: string; due_at: Date | null; status: string; assignee_name: string }>;

beforeEach(() => {
  vi.clearAllMocks(); claimStatus = null; mock.production = true;
  vi.stubEnv('ACADEMY_TIME_ZONE', 'Asia/Tashkent');
  vi.stubGlobal('fetch', mock.fetch);
  mock.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: true }) });
  mock.send.mockResolvedValue({ status: 'sent', code: null, retrySeconds: null });
  mock.identity.mockResolvedValue({ user: { id: 7, module: 'administration' }, binding: { verification_id: 'v1' } });
  entries = [{ id: 1, title: 'Актуальный отчёт', due_at: null, status: 'todo', assignee_name: 'Алина' }];
  mock.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith('SELECT id FROM telegram_task_bindings')) return { rows: [{ id: 1 }] };
    if (sql.includes('FROM board_tasks')) return { rows: entries };
    if (sql.startsWith('INSERT INTO telegram_task_reminders')) {
      expect(args[1]).toBe('2026-10-20:replace:70');
      if (claimStatus) return { rows: [] };
      claimStatus = 'attempted'; return { rows: [{ id: 10 }] };
    }
    if (sql.startsWith('UPDATE telegram_task_reminders')) { claimStatus = String(args[1]); return { rows: [] }; }
    throw new Error('Unexpected query');
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('exact morning-digest replacement', () => {
  it('deletes only the replied-to message and resends current tasks with one Mini App button outside the morning window', async () => {
    expect(await refreshTelegramDigest(request(), now)).toBe('replaced');
    expect(mock.fetch).toHaveBeenCalledOnce();
    expect(mock.fetch.mock.calls[0][0]).toContain('/deleteMessage');
    expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ chat_id: '700', message_id: 70 });
    expect(mock.send).toHaveBeenCalledExactlyOnceWith('12345:test-only', '700', expect.stringContaining('Актуальный отчёт'), 'https://crm.example.test/miniapp/tasks',
      [{ text: 'Открыть задачи', destination: {} }]);
    expect(mock.fetch.mock.invocationCallOrder[0]).toBeLessThan(mock.send.mock.invocationCallOrder[0]);
    expect(claimStatus).toBe('sent');
    expect(mock.release).toHaveBeenCalledOnce();
  });
  it('never duplicates deletion or delivery after webhook retries', async () => {
    await refreshTelegramDigest(request(), now);
    expect(await refreshTelegramDigest(request(), now)).toBe('duplicate');
    expect(mock.fetch).toHaveBeenCalledOnce(); expect(mock.send).toHaveBeenCalledOnce();
  });
  it('refuses a team summary when the live administration module has been removed', async () => {
    mock.identity.mockResolvedValue({ user: { id: 7, module: 'sales', modules: ['sales'] }, binding: { verification_id: 'v1' } });
    expect(await refreshTelegramDigest(request(), now)).toBe('invalid');
    expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.query).not.toHaveBeenCalled();
  });
  it('keeps the old summary if preparing its replacement fails', async () => {
    mock.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(refreshTelegramDigest(request(), now)).rejects.toThrow('database unavailable');
    expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
    expect(mock.release).toHaveBeenCalledOnce();
  });
  it('does not send a new summary after failed or uncertain deletion', async () => {
    mock.fetch.mockRejectedValueOnce(new Error('timeout'));
    expect(await refreshTelegramDigest(request(), now)).toBe('failed');
    expect(mock.send).not.toHaveBeenCalled(); expect(claimStatus).toBe('uncertain');
    await refreshTelegramDigest(request(), now);
    expect(mock.fetch).toHaveBeenCalledOnce();
  });
  it('does not replay a partially delivered replacement after an ambiguous send', async () => {
    mock.send.mockResolvedValueOnce({ status: 'uncertain', code: null, retrySeconds: null });
    expect(await refreshTelegramDigest(request(), now)).toBe('failed');
    expect(claimStatus).toBe('uncertain');
    await refreshTelegramDigest(request(), now);
    expect(mock.send).toHaveBeenCalledOnce();
  });
  it('puts one button on every part of a long team digest', async () => {
    entries = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, title: `Задача ${index + 1} ${'Подготовить отчёт '.repeat(6)}`, due_at: null, status: 'todo', assignee_name: 'Алина' }));
    expect(await refreshTelegramDigest(request(), now)).toBe('replaced');
    expect(mock.send.mock.calls.length).toBeGreaterThan(1);
    expect(mock.send.mock.calls.every((call) => call[4].length === 1)).toBe(true);
  });
  it('never deletes using copied bot settings outside production', async () => {
    mock.production = false;
    expect(await refreshTelegramDigest(request(), now)).toBe('unavailable');
    expect(mock.query).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
});

it.each([
  undefined,
  { ...source, date: Date.parse('2026-10-19T04:00:00Z') / 1000 },
  { ...source, from: { id: 99, is_bot: true } },
  { ...source, from: { id: 12345, is_bot: false } },
  { ...source, chat: { id: 701, type: 'private' } },
  { ...source, text: 'Обычное сообщение бота' },
  { ...source, forward_origin: { type: 'user' } },
  { ...source, message_id: -1 },
])('rejects a missing, stale, foreign or unrelated deletion target %#', (value) => {
  expect(identifyTelegramDigestReply(value, '12345', '700', 'Asia/Tashkent', now)).toBeNull();
});

it('identifies personal digests and does not reinterpret ordinary AI requests as deletion commands', () => {
  const own = { ...source, text: '📋 Ваши задачи на неделю (19.10–25.10)' };
  expect(identifyTelegramDigestReply(own, '12345', '700', 'Asia/Tashkent', now)?.section).toBe('own');
  expect(isTelegramDigestRefreshCommand('/refresh_summary')).toBe(true);
  expect(isTelegramDigestRefreshCommand('/refresh_summary@AcademyBot')).toBe(true);
  expect(isTelegramDigestRefreshCommand('Обнови задачи')).toBe(false);
  expect(buildTelegramWeeklyDigest([], now, 'Asia/Tashkent')[0].text).toContain('19.10–25.10');
});
