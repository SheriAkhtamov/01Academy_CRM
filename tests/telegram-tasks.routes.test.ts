import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ identity: vi.fn(), bind: vi.fn(), users: vi.fn(), canDownload: vi.fn(), tasks: vi.fn(), detail: vi.fn(), task: vi.fn() }));
vi.mock('../server/config', () => ({ isProductionEnvironment: false, isDevelopmentEnvironment: false, appConfig: { session: { secret: 'test-session-secret' }, server: { appUrl: 'https://crm.example.test' }, integrations: { telegramTasks: { botToken: '12345:test-only-token', webhookSecret: 'test-webhook-secret' } } } }));
vi.mock('../server/services/telegram-tasks', () => ({ getTelegramTaskIdentity: mock.identity, bindTelegramTaskEmployee: mock.bind, TelegramBindingDenied: class extends Error {}, telegramTaskAccess: { getAssignableUsers: mock.users, canDownload: mock.canDownload } }));
vi.mock('../server/storage', () => ({ storage: { board: { getDefaultBoard: async () => ({ id: 1 }), getBoard: async () => ({ id: 1 }), getTasks: mock.tasks, getTaskDetail: mock.detail, getTask: mock.task } } }));
import { registerTelegramTaskRoutes } from '../server/routes/telegram-tasks.routes';
import { signTaskToken } from '../server/services/telegram-tasks-crypto';
const user = { id: 7, fullName: 'Employee Name', phone: '+998901234567', module: 'teacher', modules: ['teacher'], isActive: true, isArchived: false, password: 'never-return', credentialPasswordCiphertext: 'never-return' };
const binding = { bot_id: '12345', telegram_user_id: '654321', user_id: 7, verified_phone: '998901234567', verification_id: 'v1' };
const secret = 'test-session-secret:telegram-tasks:12345:test-only-token';
function token(scope: 'telegram-tasks' | 'telegram-task-file' = 'telegram-tasks', id = 8) {
  const iat = Math.floor(Date.now() / 1000);
  return signTaskToken({ scope, botId: '12345', telegramUserId: '654321', userId: 7, verificationId: 'v1', iat, exp: iat + 120, ...(scope === 'telegram-task-file' ? { attachmentId: id } : {}) }, secret);
}
function app() {
  const app = express(); app.use(express.json()); registerTelegramTaskRoutes(app);
  app.get('/api/crm-test', (req, res) => res.status(req.user ? 200 : 401).end());
  return app;
}
const message = { from: { id: 654321 }, chat: { id: 654321, type: 'private' }, text: '/start' };
const webhook = (body: object) => request(app()).post('/api/incoming/telegram-tasks').set('X-Telegram-Bot-Api-Secret-Token', 'test-webhook-secret').send({ message: body });
beforeEach(() => { vi.clearAllMocks(); mock.identity.mockResolvedValue({ user, binding }); mock.bind.mockResolvedValue({ user, binding }); mock.tasks.mockResolvedValue([]); mock.canDownload.mockResolvedValue(true); mock.users.mockResolvedValue([{ id: 7, fullName: user.fullName }]); });
describe('Telegram bot and isolated task API', () => {
  it('rejects unauthenticated webhooks before checking employee data', async () => {
    expect((await request(app()).post('/api/incoming/telegram-tasks').send({ message })).status).toBe(403);
    expect(mock.identity).not.toHaveBeenCalled();
  });
  it('offers a contact keyboard to unregistered employees', async () => {
    mock.identity.mockResolvedValue(null);
    const response = await webhook(message);
    expect(response.body.reply_markup.keyboard[0][0].request_contact).toBe(true);
    expect(response.body.reply_markup.inline_keyboard).toBeUndefined();
  });
  it('greets a verified employee with an inline Mini App button', async () => {
    const response = await webhook({ ...message, contact: { user_id: 654321, phone_number: '+998901234567' } });
    expect(mock.bind).toHaveBeenCalledWith('12345', '654321', '+998901234567');
    expect(response.body.text).toContain(user.fullName);
    expect(response.body.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://crm.example.test/miniapp/tasks');
  });
  it.each([
    { contact: { user_id: 999, phone_number: '+998901234567' } },
    { contact: { phone_number: '+998901234567' } },
    { contact: { user_id: 654321, phone_number: '+998901234567' }, forward_origin: {} },
  ])('never accepts a foreign or forwarded contact', async (extra) => {
    const response = await webhook({ ...message, ...extra });
    expect(mock.bind).not.toHaveBeenCalled();
    expect(response.body.reply_markup.inline_keyboard).toBeUndefined();
  });
  it('ignores group chats and mismatched senders', async () => {
    await webhook({ ...message, chat: { id: 654321, type: 'group' } });
    await webhook({ ...message, chat: { id: 11, type: 'private' } });
    expect(mock.identity).not.toHaveBeenCalled();
  });
  it('exchanges signed initData for a task-only token without a CRM cookie', async () => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 654321 }) }); params.sort();
    const key = createHmac('sha256', 'WebAppData').update('12345:test-only-token').digest();
    params.set('hash', createHmac('sha256', key).update([...params.entries()].map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
    const response = await request(app()).post('/api/miniapp/auth').send({ initData: params.toString() });
    expect(response.status).toBe(200); expect(response.body.token).toBeTypeOf('string');
    expect(response.body.session.user.password).toBeUndefined(); expect(response.body.session.user.credentialPasswordCiphertext).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await request(app()).get('/api/crm-test').set('Authorization', `Bearer ${response.body.token}`)).status).toBe(401);
  });
  it('rejects forged launches and employees without a valid binding', async () => {
    expect((await request(app()).post('/api/miniapp/auth').send({ initData: 'user=654321' })).status).toBe(401);
    mock.identity.mockResolvedValue(null);
    expect((await request(app()).get('/api/miniapp/board/tasks').set('Authorization', `Bearer ${token()}`)).status).toBe(401);
    expect(mock.tasks).not.toHaveBeenCalled();
  });
  it('preserves board read permissions and checks the live binding', async () => {
    const response = await request(app()).get('/api/miniapp/board/tasks').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200); expect(mock.tasks).toHaveBeenCalledWith(1, 7, false);
    expect(mock.identity).toHaveBeenCalledWith('12345', '654321', expect.objectContaining({ userId: 7, verificationId: 'v1' }));
  });
  it('denies other employees task details and assignee-only acceptance', async () => {
    mock.detail.mockResolvedValue({ creatorId: 99, assigneeId: 98 });
    expect((await request(app()).get('/api/miniapp/board/tasks/1').set('Authorization', `Bearer ${token()}`)).status).toBe(403);
    mock.task.mockResolvedValue({ id: 1, creatorId: 99, assigneeId: 7, status: 'done' });
    expect((await request(app()).patch('/api/miniapp/board/tasks/1/status').set('Authorization', `Bearer ${token()}`).send({ status: 'accepted' })).status).toBe(403);
  });
  it('does not expose other modules or allow lead assignment', async () => {
    expect((await request(app()).get('/api/miniapp/sales').set('Authorization', `Bearer ${token()}`)).status).toBe(404);
    expect((await request(app()).post('/api/miniapp/board/tasks').set('Authorization', `Bearer ${token()}`).send({ leadId: 3 })).status).toBe(403);
  });
  it('issues an exact-file ticket only after access checks', async () => {
    const response = await request(app()).post('/api/miniapp/attachments/8/link').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200); expect(mock.canDownload).toHaveBeenCalledWith(user, 8);
    const ticket = new URL(response.body.url).searchParams.get('ticket');
    expect((await request(app()).get(`/api/miniapp/files/9?ticket=${ticket}`)).status).toBe(401);
    expect((await request(app()).get('/api/miniapp/board/tasks').set('Authorization', `Bearer ${ticket}`)).status).toBe(401);
    mock.canDownload.mockResolvedValue(false);
    expect((await request(app()).post('/api/miniapp/attachments/8/link').set('Authorization', `Bearer ${token()}`)).status).toBe(403);
  });
});
