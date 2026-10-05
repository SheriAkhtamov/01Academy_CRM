import express from 'express';
import session from 'express-session';
import request from 'supertest';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_USER_PHOTO_BYTES } from '../shared/user-photo';
const mocks = vi.hoisted(() => ({ storage: { getUser: vi.fn(), getUsers: vi.fn(), createAuditLog: vi.fn() }, pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../server/storage', () => ({ storage: mocks.storage }));
vi.mock('../server/db', () => ({ pool: mocks.pool }));
vi.mock('../server/services/auth', () => ({ authService: {
  sanitizeUser: (user: Record<string, unknown>) => { const { password: _password, ...rest } = user; return rest; },
  hashPassword: vi.fn().mockResolvedValue('test-hash'), verifyPassword: vi.fn().mockResolvedValue(true),
} }));
vi.mock('../server/services/email', () => ({ emailService: { sendWelcomeEmail: vi.fn() } }));
import userRoutes from '../server/routes/user.routes';
import authRoutes from '../server/routes/auth.routes';
import { USER_PHOTO_DIR, userPhotoPath } from '../server/middleware/user-photo.middleware';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2nUAAAAASUVORK5CYII=', 'base64');
const employee = (id: number, module: string) => ({ id, email: `user${id}@example.com`, password: 'test-hash', fullName: `Employee ${id}`, position: null, phone: null, avatarUrl: null as string | null, module, modules: [module], isActive: true, isArchived: false });
let users: Map<number, ReturnType<typeof employee>>;
let originalFiles: string[];
let query: ReturnType<typeof vi.fn<(statement: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>>>;
const app = express();
app.use(express.json()); app.use(session({ secret: 'photo-route-test', resave: false, saveUninitialized: false }));
app.post('/test/session', (req, res) => { req.session.userId = req.body.id; req.session.save(() => res.json({ ok: true })); });
app.use('/api/users', userRoutes); app.use('/api/auth', authRoutes);
const login = async (id = 7) => { const agent = request.agent(app); await agent.post('/test/session').send({ id }); return agent; };
const profile = () => ({ fullName: 'Employee 7', email: 'user7@example.com', position: '', phone: null });
beforeEach(async () => {
  vi.clearAllMocks(); users = new Map([[7, employee(7, 'administration')], [20, employee(20, 'finance')]]);
  mocks.storage.getUser.mockImplementation(async (id: number) => ({ ...users.get(id) }));
  mocks.storage.getUsers.mockImplementation(async () => [...users.values()]); mocks.storage.createAuditLog.mockResolvedValue(undefined);
  query = vi.fn(async (statement: string, params: any[] = []) => {
    if (statement.includes('INSERT INTO users')) {
      const created = { ...employee(21, params[8]), email: params[0], fullName: params[3], avatarUrl: params[10] };
      users.set(21, created); return { rows: [created], rowCount: 1 };
    }
    if (statement.includes('SELECT password, email')) return { rows: [users.get(params[0])], rowCount: 1 };
    if (statement.includes('SELECT id, full_name, module, is_active')) {
      const user = users.get(params[0])!;
      return { rows: [{ id: user.id, full_name: user.fullName, module: user.module, is_active: true, is_archived: false }], rowCount: 1 };
    }
    if (statement.includes('SELECT module FROM user_modules')) return { rows: [{ module: users.get(params[0])?.module }], rowCount: 1 };
    if (statement.includes('UPDATE users') && statement.includes('avatar_url')) {
      const user = users.get(params[0])!;
      const avatarUrl = statement.includes('COALESCE($7') ? params[6] : params[1];
      if (avatarUrl) users.set(user.id, { ...user, avatarUrl });
    }
    return { rows: [], rowCount: 1 };
  });
  mocks.pool.connect.mockResolvedValue({ query, release: vi.fn() }); mocks.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  await fs.mkdir(USER_PHOTO_DIR, { recursive: true }); originalFiles = await fs.readdir(USER_PHOTO_DIR);
});
afterEach(async () => {
  const files = await fs.readdir(USER_PHOTO_DIR);
  await Promise.all(files.filter((file) => !originalFiles.includes(file)).map((file) => fs.unlink(userPhotoPath(file)!).catch(() => undefined)));
});

describe('profile photos saved with employee forms', () => {
  it('saves a photo atomically with own settings and serves it only to authenticated users', async () => {
    const agent = await login();
    const response = await agent.put('/api/auth/me/settings').field('profile', JSON.stringify(profile())).attach('photo', png, 'photo.png');
    expect(response.status).toBe(200); expect(response.body.user.avatarUrl).toMatch(/^\/api\/users\/photos\/[A-Za-z0-9_-]{21}$/);
    const photo = await agent.get(response.body.user.avatarUrl);
    expect(photo.status).toBe(200); expect(photo.headers['content-type']).toContain('image/png'); expect(photo.headers['cache-control']).toContain('private');
    expect((await request(app).get(response.body.user.avatarUrl)).status).toBe(401);
    const update = query.mock.calls.find(([statement]) => statement.includes('UPDATE users'))!;
    expect(update[1]![6]).toBe(response.body.user.avatarUrl); expect(query).toHaveBeenCalledWith('COMMIT');
  });
  it('includes the selected photo in a new employee transaction', async () => {
    const response = await (await login()).post('/api/users').field('profile', JSON.stringify({ fullName: 'New Employee', module: 'finance', modules: ['finance'] })).attach('photo', png, 'new.png');
    expect(response.status).toBe(200); expect(response.body.avatarUrl).toMatch(/^\/api\/users\/photos\//);
    expect(query.mock.calls.find(([statement]) => statement.includes('INSERT INTO users'))![1]![10]).toBe(response.body.avatarUrl);
    expect(query).toHaveBeenCalledWith('COMMIT'); expect((await fs.readdir(USER_PHOTO_DIR))).toHaveLength(originalFiles.length + 1);
  });
  it('allows an administrator to change an employee photo in the edit form', async () => {
    const response = await (await login()).put('/api/users/20').field('profile', '{}').attach('photo', png, 'new.png');
    expect(response.status).toBe(200); expect(response.body.avatarUrl).toMatch(/^\/api\/users\/photos\//);
    const update = query.mock.calls.find(([statement]) => statement.includes('UPDATE users'))!;
    expect(update[1]!.slice(0, 2)).toEqual([20, response.body.avatarUrl]);
  });
  it('keeps the existing photo when saving a form without another upload', async () => {
    users.set(7, { ...users.get(7)!, avatarUrl: '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa' });
    const response = await (await login()).put('/api/auth/me/settings').send(profile());
    expect(response.status).toBe(200); expect(response.body.user.avatarUrl).toBe('/api/users/photos/aaaaaaaaaaaaaaaaaaaaa');
    expect(query.mock.calls.find(([statement]) => statement.includes('UPDATE users'))![1]![6]).toBeNull();
  });
  it.each(['<svg onload="alert(1)">', '<html>fake photo</html>', '%PDF-1.7'])('rejects a non-image despite a supplied image type: %s', async (bytes) => {
    const response = await (await login()).put('/api/auth/me/settings').field('profile', JSON.stringify(profile())).attach('photo', Buffer.from(bytes), { filename: 'fake.png', contentType: 'image/png' });
    expect(response.status).toBe(400); expect(response.body.error).toBe('profilePhotoTypeUnsupported'); expect(mocks.pool.connect).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await fs.readdir(USER_PHOTO_DIR)).toEqual(originalFiles));
  });
  it('removes an upload when saving fails and never marks it retained', async () => {
    const execute = query.getMockImplementation()!;
    query.mockImplementation(async (statement: string, params: any[] = []) => {
      if (statement === 'COMMIT') throw new Error('Database unavailable');
      return execute(statement, params);
    });
    const response = await (await login()).put('/api/auth/me/settings').field('profile', JSON.stringify(profile())).attach('photo', png, 'photo.png');
    expect(response.status).toBe(500);
    await vi.waitFor(async () => expect(await fs.readdir(USER_PHOTO_DIR)).toEqual(originalFiles));
  });
  it('cleans an unauthorized profile update and refuses unauthenticated uploads', async () => {
    expect((await (await login(20)).put('/api/users/7').field('profile', '{}').attach('photo', png, 'photo.png')).status).toBe(403);
    expect((await request(app).post('/api/users').field('profile', '{}').attach('photo', png, 'photo.png')).status).toBe(401);
    expect(mocks.pool.connect).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await fs.readdir(USER_PHOTO_DIR)).toEqual(originalFiles));
  });
  it('rejects files larger than 10 MB and cleans partial data', async () => {
    const response = await (await login()).put('/api/auth/me/settings').field('profile', JSON.stringify(profile())).attach('photo', Buffer.alloc(MAX_USER_PHOTO_BYTES + 1), 'large.png');
    expect(response.status).toBe(413); expect(response.body.error).toBe('messageFileTooLarge');
    await vi.waitFor(async () => expect(await fs.readdir(USER_PHOTO_DIR)).toEqual(originalFiles));
  });
  it('rejects malformed multipart profiles without leaving the uploaded photo', async () => {
    const response = await (await login()).put('/api/auth/me/settings').field('profile', '{broken').attach('photo', png, 'photo.png');
    expect(response.status).toBe(400); expect(mocks.pool.connect).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await fs.readdir(USER_PHOTO_DIR)).toEqual(originalFiles));
  });
});
