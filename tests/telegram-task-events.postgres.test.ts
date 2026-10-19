import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ db: null as any, pool: null as any, identity: vi.fn(), fetch: vi.fn(), production: true }));
vi.mock('../server/db', () => ({ get db() { return mocks.db; }, get pool() { return mocks.pool; } }));
vi.mock('../server/config', () => ({
  get isProductionEnvironment() { return mocks.production; },
  appConfig: { server: { appUrl: 'https://crm.example.test' }, integrations: { telegramTasks: { botToken: '12345:test-only', webhookSecret: 'test-only' } } },
}));
vi.mock('../server/services/telegram-tasks', () => ({ getTelegramTaskIdentity: mocks.identity }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
import { boardStorage } from '../server/storage/board.storage';
import { processTelegramTaskEvents } from '../server/services/telegram-task-events';
import { processTelegramTaskReminders } from '../server/services/telegram-task-reminders';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `task_events_${randomUUID().replace(/-/g, '')}`;
describe.skipIf(!url)('transactional Telegram task notifications', () => {
  let admin: Pool; let pool: Pool;
  const create = (assigneeId = 8, requestKey?: string) => boardStorage.createTaskWithActivity({
    boardId: 1, title: 'Отчёт', creatorId: 7, assigneeId, status: 'todo',
  }, { actorId: 7, type: 'created' }, requestKey);
  const events = async () => (await pool.query('SELECT * FROM telegram_task_events ORDER BY id')).rows;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    mocks.pool = pool; mocks.db = drizzle(pool);
    await pool.query(`
      CREATE TABLE users(id integer PRIMARY KEY, full_name text, is_active boolean DEFAULT true, is_archived boolean DEFAULT false);
      CREATE TABLE boards(id serial PRIMARY KEY, name text NOT NULL);
      CREATE TABLE board_tasks(id serial PRIMARY KEY, board_id integer REFERENCES boards(id), title varchar(255) NOT NULL,
        description text, status varchar(20) DEFAULT 'backlog', priority varchar(10) DEFAULT 'normal', color varchar(20),
        position integer DEFAULT 0, creator_id integer REFERENCES users(id), assignee_id integer REFERENCES users(id),
        lead_id integer, legacy_academy_task_id integer, telephony_call_id integer, due_at timestamp,
        accepted_at timestamp, accepted_by integer, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      CREATE TABLE board_task_activity(id serial PRIMARY KEY, task_id integer REFERENCES board_tasks(id) ON DELETE CASCADE,
        actor_id integer, type varchar(40), from_value varchar(120), to_value varchar(120), meta jsonb, created_at timestamp DEFAULT now());
      CREATE TABLE board_task_comments(id serial PRIMARY KEY, task_id integer REFERENCES board_tasks(id) ON DELETE CASCADE,
        author_id integer, body text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      CREATE TABLE board_task_attachments(id serial PRIMARY KEY, task_id integer REFERENCES board_tasks(id) ON DELETE CASCADE,
        file_name varchar(255), original_name varchar(255), mime_type varchar(120), size integer DEFAULT 0, uploaded_by integer, created_at timestamp DEFAULT now());
      CREATE TABLE telegram_task_bindings(id serial PRIMARY KEY, bot_id text, user_id integer REFERENCES users(id), telegram_user_id text, verification_id text);
    `);
    await pool.query(readFileSync('migrations/0103_telegram_task_reminders.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0158_telegram_task_events.sql', 'utf8'));
  });
  beforeEach(async () => {
    vi.clearAllMocks(); mocks.production = true;
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    mocks.identity.mockImplementation(async (_bot, chat) => ({ user: { id: Number(chat), module: 'sales' }, binding: { verification_id: 'v1' } }));
    await pool.query('TRUNCATE users, boards, board_tasks, telegram_task_events, telegram_task_bindings RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO users(id,full_name) VALUES(7,'Автор'),(8,'Алина'),(9,'Боб'); INSERT INTO boards(id,name) VALUES(1,'Задачи'); INSERT INTO telegram_task_bindings(bot_id,user_id,telegram_user_id,verification_id) VALUES('12345',7,'7','v1'),('12345',8,'8','v1'),('12345',9,'9','v1')");
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it('atomically creates one event under concurrent creation retries and sends once after a restart', async () => {
    const [first, retry] = await Promise.all([create(8, 'request-one'), create(8, 'request-one')]);
    expect(first.id).toBe(retry.id);
    expect(await events()).toMatchObject([{ recipient_id: 8, status: 'pending', payload: { kind: 'created' } }]);
    expect((await Promise.all([processTelegramTaskEvents(), processTelegramTaskEvents()])).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await processTelegramTaskEvents()).toBe(0);
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(payload.chat_id).toBe('8');
    expect(payload.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`https://crm.example.test/miniapp/tasks?view=mine&task=${first.id}`);
  });
  it('rolls back the task and activity if the notification cannot be queued', async () => {
    await pool.query("ALTER TABLE telegram_task_events ADD CONSTRAINT reject_event CHECK(recipient_id <> 8)");
    try { await expect(create()).rejects.toBeTruthy(); }
    finally { await pool.query('ALTER TABLE telegram_task_events DROP CONSTRAINT reject_event'); }
    expect((await pool.query('SELECT * FROM board_tasks')).rows).toEqual([]);
    expect((await pool.query('SELECT * FROM board_task_activity')).rows).toEqual([]);
    expect(await events()).toEqual([]);
  });
  it('queues changed fields, reassignment and old assignee notices, and ignores a no-op', async () => {
    const task = await create(); await pool.query('TRUNCATE telegram_task_events');
    await boardStorage.updateTaskWithActivities(task.id, 'todo', { title: 'План', description: 'Текст', priority: 'urgent', assigneeId: 9, dueAt: new Date('2026-10-19T10:00:00Z') }, [], undefined, 7);
    const notices = (await events()).map((event) => event.payload);
    expect(notices).toMatchObject([{ recipientId: 9, kind: 'assigned', fields: ['title','description','priority','dueAt','assigneeId'] }, { recipientId: 8, kind: 'unassigned' }]);
    await boardStorage.updateTaskWithActivities(task.id, 'todo', { title: 'План' }, [], undefined, 7);
    expect(await events()).toHaveLength(2);
    expect(await processTelegramTaskEvents()).toBe(2);
    const payloads = mocks.fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(payloads[1].reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://crm.example.test/miniapp/tasks?view=mine');
  });
  it('queues progress, completion, acceptance and reopening, but rejects a stale transition', async () => {
    const task = await create(); await pool.query('TRUNCATE telegram_task_events');
    for (const [from, to, actor] of [['todo','in_progress',8],['in_progress','done',8],['done','accepted',7],['accepted','todo',7]] as const) {
      await boardStorage.updateTaskWithActivities(task.id, from, { status: to }, [{ actorId: actor, type: 'status_changed' }]);
    }
    expect((await events()).map((event) => event.payload.kind)).toEqual(['started','done','accepted','reopened']);
    expect((await events())[2].payload.destination.view).toBe('archive');
    await expect(boardStorage.updateTaskWithActivities(task.id, 'done', { status: 'accepted' }, [{ actorId: 7, type: 'accepted' }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await events()).toHaveLength(4);
  });
  it('links new comments and retry-safe attachments to exact items, and preserves deletion notices after cascade', async () => {
    const task = await create(); await pool.query('TRUNCATE telegram_task_events');
    const comment = await boardStorage.createCommentWithActivity({ taskId: task.id, authorId: 7, body: 'Вопрос' }, { actorId: 7, type: 'comment_added' });
    const data = { taskId: task.id, uploadedBy: 8, fileName: 'file.pdf', originalName: 'Отчёт.pdf' };
    const file = await boardStorage.createAttachmentWithActivity(data, 'upload-one');
    await boardStorage.createAttachmentWithActivity(data, 'upload-one');
    expect((await events()).map((event) => event.payload.destination)).toMatchObject([{ commentId: comment.id, section: 'comments' }, { attachmentId: file.id, section: 'attachments' }]);
    expect(await processTelegramTaskEvents()).toBe(2);
    expect(await boardStorage.deleteTask(task.id, 7)).toEqual(['file.pdf']);
    expect(await processTelegramTaskEvents()).toBe(1);
    expect((await events()).at(-1).payload).toMatchObject({ kind: 'deleted', recipientId: 8, destination: { view: 'mine' } });
  });
  it('skips stale recipients, deleted comments, inactive/unbound identities and never sends from development', async () => {
    const task = await create(); mocks.production = false;
    expect(await processTelegramTaskEvents()).toBe(0);
    expect((await events())[0].status).toBe('pending');
    mocks.production = true; mocks.identity.mockResolvedValue(null);
    expect(await processTelegramTaskEvents()).toBe(0);
    expect((await events())[0].status).toBe('skipped');
    mocks.identity.mockImplementation(async (_bot, chat) => ({ user: { id: Number(chat) } }));
    await boardStorage.createCommentWithActivity({ taskId: task.id, authorId: 7, body: 'Удалён' }, { actorId: 7, type: 'comment_added' });
    await pool.query('DELETE FROM board_task_comments');
    expect(await processTelegramTaskEvents()).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('honours Telegram cooldown across workers, safely retries 429, and never retries uncertain sends', async () => {
    await create();
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 120 } }) });
    expect(await processTelegramTaskEvents()).toBe(0);
    expect((await events())[0].status).toBe('deferred');
    expect(await processTelegramTaskEvents()).toBe(0);
    expect(await processTelegramTaskReminders('Asia/Tashkent')).toBe(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await pool.query("UPDATE telegram_task_events SET next_attempt_at = now() AT TIME ZONE 'UTC' - interval '1 second'");
    expect(await processTelegramTaskEvents()).toBe(1);
    await create(); mocks.fetch.mockRejectedValueOnce(new Error('timeout'));
    expect(await processTelegramTaskEvents()).toBe(0);
    expect((await events()).at(-1).status).toBe('uncertain');
    await processTelegramTaskEvents();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it('preserves an unsent pending event when identity validation fails before the Telegram request', async () => {
    await create();
    mocks.identity.mockRejectedValueOnce(new Error('temporary database failure'));
    await expect(processTelegramTaskEvents()).rejects.toThrow('temporary database failure');
    expect((await events())[0].status).toBe('pending');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await processTelegramTaskEvents()).toBe(1);
  });
});
