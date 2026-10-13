import bcrypt from 'bcrypt';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: { getUser: vi.fn(), getUsers: vi.fn(), getUserByLoginOrEmail: vi.fn(), updateUser: vi.fn(), createAuditLog: vi.fn() },
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('../server/storage', () => ({ storage: mocks.storage }));
vi.mock('../server/db', () => ({ pool: mocks.pool }));

type StaffUser = { id: number; email: string; password: string; fullName: string; module: string; modules: string[]; isActive: boolean; isArchived: boolean; phone?: string | null };
type MockQuery = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
let users: Map<number, StaffUser>;
let client: { query: ReturnType<typeof vi.fn<MockQuery>>; release: ReturnType<typeof vi.fn> };
let app: express.Express;
let hashPassword: ReturnType<typeof vi.spyOn>;
const password = 'Secret123';
const invalidLogins = ['bad name', 'user@domain', 'name\u0000', 'name\u009f', 'a'.repeat(255), 'İ'.repeat(128), 'İ'.repeat(254)];

beforeEach(async () => {
  vi.clearAllMocks();
  const hashed = await bcrypt.hash(password, 1);
  users = new Map([
    [7, { id: 7, email: 'admin@example.com', password: hashed, fullName: 'Admin User', module: 'administration', modules: ['administration'], isActive: true, isArchived: false }],
    [20, { id: 20, email: 'existing.staff', password: hashed, fullName: 'Selected Employee', module: 'sales', modules: ['sales'], isActive: true, isArchived: false }],
  ]);
  mocks.storage.getUser.mockReset().mockImplementation(async (id: number) => users.get(id));
  mocks.storage.getUsers.mockReset().mockImplementation(async () => Array.from(users.values()));
  mocks.storage.getUserByLoginOrEmail.mockReset().mockImplementation(async (identifier: string) =>
    Array.from(users.values()).find((user) => [user.email, user.fullName].some((value) => value.toLowerCase() === identifier.toLowerCase())));
  mocks.storage.updateUser.mockReset().mockImplementation(async (id: number, values: Partial<StaffUser>) => {
    const updated = { ...users.get(id)!, ...values }; users.set(id, updated); return updated;
  });
  mocks.storage.createAuditLog.mockReset().mockResolvedValue(undefined);
  mocks.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  client = {
    release: vi.fn(),
    query: vi.fn(async (statement: string, params: unknown[] = []) => {
      if (statement.includes('INSERT INTO users')) {
        const created = { ...users.get(20)!, id: 21, email: String(params[0]), password: String(params[1]), fullName: String(params[3]), module: String(params[8]), modules: [String(params[8])] };
        users.set(21, created); return { rows: [created], rowCount: 1 };
      }
      const selected = users.get(Number(params[0]));
      if (statement.includes('SELECT password, email')) return { rows: selected ? [{ password: selected.password, email: selected.email }] : [] };
      if (statement.includes('SELECT id, full_name, module, is_active')) return { rows: selected ? [{ id: selected.id, full_name: selected.fullName, module: selected.module, is_active: selected.isActive, is_archived: selected.isArchived }] : [] };
      if (statement.includes('SELECT module FROM user_modules')) return { rows: selected?.modules.map((module) => ({ module })) ?? [] };
      if (statement.includes('SELECT funnel_id FROM academy_sales_funnel_users')) return { rows: selected?.id === 20 ? [{ funnel_id: 1 }] : [] };
      if (statement.includes('SELECT id FROM academy_sales_funnels')) return { rows: [{ id: 1 }] };
      if (statement.includes('UPDATE users') && statement.includes('email = $3')) {
        users.set(selected!.id, { ...selected!, fullName: String(params[1]), email: String(params[2]), phone: params[4] as string | null, password: typeof params[5] === 'string' ? params[5] : selected!.password });
      } else if (statement.includes('UPDATE users')) {
        const updated = { ...selected! };
        if (statement.includes('full_name = $2')) updated.fullName = String(params[1]);
        users.set(updated.id, updated);
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  mocks.pool.connect.mockReset().mockResolvedValue(client);
  const { authService } = await import('../server/services/auth');
  hashPassword = vi.spyOn(authService, 'hashPassword').mockImplementation(async (value) => `hash:${value}`);
  const [{ default: authRoutes }, { default: userRoutes }] = await Promise.all([import('../server/routes/auth.routes'), import('../server/routes/user.routes')]);
  app = express(); app.use(express.json());
  app.use(session({ secret: 'staff-login-test', resave: false, saveUninitialized: false }));
  app.post('/test/session', (req, res) => { req.session.userId = Number(req.body.id ?? 7); req.session.save(() => res.json({ ok: true })); });
  app.use('/api/auth', authRoutes); app.use('/api/users', userRoutes);
});
afterEach(() => vi.restoreAllMocks());

async function agentFor(id = 7) {
  const agent = request.agent(app); await agent.post('/test/session').send({ id }); return agent;
}
function expectNoCredentialWrites() {
  expect(mocks.storage.updateUser).not.toHaveBeenCalled(); expect(hashPassword).not.toHaveBeenCalled();
  expect(mocks.pool.connect).not.toHaveBeenCalled(); expect(mocks.pool.query).not.toHaveBeenCalled();
}

describe('plain employee login API policy', () => {
  it.each([' GolosBaxti ', ' Staff@Example.COM ', 'İ'.repeat(127)])('creates a supplied identifier %s without replacing it with an automatic login', async (email) => {
    const response = await (await agentFor()).post('/api/users').send({ fullName: 'New Employee', module: 'sales', email });
    expect(response.status, response.body.error).toBe(200); expect(response.body.email).toBe(email.trim().toLowerCase());
    expect(response.body.email.length).toBeLessThanOrEqual(254);
    const insert = client.query.mock.calls.find(([statement]) => statement.includes('INSERT INTO users'));
    expect(insert?.[1]?.[0]).toBe(email.trim().toLowerCase()); expect(insert?.[1]?.[1]).toEqual(expect.stringMatching(/^hash:/));
    expect(hashPassword).toHaveBeenCalledExactlyOnceWith(expect.any(String)); expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query.mock.calls.some(([statement]) => statement.includes('INSERT INTO audit_logs'))).toBe(true);
  });
  it.each([undefined, '', '   '])('retains automatic generation for absent or blank optional input %j', async (email) => {
    const response = await (await agentFor()).post('/api/users').send({ fullName: 'New Employee', module: 'sales', ...(email === undefined ? {} : { email }) });
    expect(response.status, response.body.error).toBe(200); expect(response.body.email).toMatch(/^sales\.new\.employee\.[a-z0-9]+@01academy\.local$/);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
  it.each([...invalidLogins, null, 123, {}])('rejects malformed supplied create identifier %j before lookup, hashing or transaction', async (email) => {
    const response = await (await agentFor()).post('/api/users').send({ fullName: 'New Employee', module: 'sales', email });
    expect(response.status).toBe(400); expect(response.body.error).toBe('invalidLogin');
    expect(mocks.storage.getUsers).not.toHaveBeenCalled(); expectNoCredentialWrites();
  });
  it('rejects case-insensitive supplied duplicates before creation', async () => {
    users.get(20)!.email = 'golosbaxti';
    const response = await (await agentFor()).post('/api/users').send({ fullName: 'New Employee', module: 'sales', email: ' GoLosBaxti ' });
    expect(response.status).toBe(409); expect(response.body.error).toBe('loginAlreadyExists'); expectNoCredentialWrites();
  });
  it.each([' GolosBaxti ', 'İ'.repeat(127)])('changes an employee plain login and keeps audit/session revocation without changing its password', async (email) => {
    const oldPassword = users.get(20)!.password;
    const normalized = email.trim().toLowerCase();
    const response = await (await agentFor()).patch('/api/users/20/credentials').send({ email });
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ email: normalized, loginChanged: true, passwordChanged: false });
    expect(response.body.email.length).toBeLessThanOrEqual(254);
    expect(mocks.storage.updateUser).toHaveBeenCalledExactlyOnceWith(20, { email: normalized });
    expect(users.get(20)!.password).toBe(oldPassword); expect(hashPassword).not.toHaveBeenCalled();
    expect(mocks.pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "session"'), ['20', null]);
    expect(mocks.pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM saved_accounts'), [20]);
    expect(mocks.storage.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_USER_CREDENTIALS', entityId: 20, newValues: [expect.objectContaining({ email: normalized, passwordChanged: false })] }));
  });
  it.each(['', ...invalidLogins])('rejects invalid required credential identifier %j before writes', async (email) => {
    const response = await (await agentFor()).patch('/api/users/20/credentials').send({ email });
    expect(response.status).toBe(400); expect(response.body.error).toBe(email === '' ? 'loginRequired' : 'invalidLogin'); expectNoCredentialWrites();
  });
  it('keeps duplicate, password confirmation, archive and administrator permission gates', async () => {
    users.get(7)!.email = 'golosbaxti'; const admin = await agentFor();
    let response = await admin.patch('/api/users/20/credentials').send({ email: 'GOLOSbaxti' });
    expect(response.status).toBe(400); expect(response.body.error).toBe('loginAlreadyExists');
    response = await admin.patch('/api/users/20/credentials').send({ email: 'new.staff', password: 'NewSecret123', confirmPassword: 'Wrong123' });
    expect(response.status).toBe(400); expect(response.body.error).toBe('passwordsDoNotMatch'); expectNoCredentialWrites();
    const employeeAgent = await agentFor(20); response = await employeeAgent.patch('/api/users/7/credentials').send({ email: 'new.staff' });
    expect(response.status).toBe(403); expectNoCredentialWrites();
    users.get(20)!.isArchived = true; response = await admin.patch('/api/users/20/credentials').send({ email: 'new.staff' });
    expect(response.status).toBe(409); expect(response.body.error).toBe('employeeArchived'); expectNoCredentialWrites();
  });
  it('saves an existing plain-login employee profile without allowing credential writes through that endpoint', async () => {
    users.get(20)!.email = 'Golosbaxti'; const agent = await agentFor();
    const response = await agent.put('/api/users/20').send({ fullName: 'Updated Employee', phoneNumbers: ['+49 30 123456789'] });
    expect(response.status, response.body.error).toBe(200); expect(response.body).toMatchObject({ fullName: 'Updated Employee', email: 'Golosbaxti' });
    const update = client.query.mock.calls.find(([statement]) => statement.includes('UPDATE users'));
    expect(update?.[0]).not.toContain('email ='); expect(update?.[1]).toEqual([20, 'Updated Employee', '+49 30 123456789']);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    const blocked = await agent.put('/api/users/20').send({ email: 'new.staff' });
    expect(blocked.status).toBe(400); expect(blocked.body.error).toBe('loginManagedInCredentials');
  });
});

describe('plain own-account settings, credentials and authentication', () => {
  it('saves profile fields with an unchanged normalized plain login without asking for the password or revoking sessions', async () => {
    users.get(7)!.email = 'Golosbaxti';
    const response = await (await agentFor()).put('/api/auth/me/settings').send({ fullName: 'Updated Owner', email: ' GOLOSbaxti ', position: 'Director', phone: '+998901234567' });
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ loginChanged: false, passwordChanged: false, user: { fullName: 'Updated Owner', email: 'golosbaxti' } });
    expect(client.query).toHaveBeenCalledWith('COMMIT'); expect(hashPassword).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([statement]) => statement.includes('DELETE FROM "session"'))).toBe(false);
    expect(mocks.storage.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_OWN_SETTINGS' }));
  });
  it.each([
    ['/api/auth/me/settings', ' GolosBaxti '], ['/api/auth/me/credentials', ' GolosBaxti '],
    ['/api/auth/me/settings', 'İ'.repeat(127)], ['/api/auth/me/credentials', 'İ'.repeat(127)],
  ])('changes to a plain own login on %s after verifying current password', async (path, email) => {
    const agent = await agentFor();
    const response = path.endsWith('settings')
      ? await agent.put(path).send({ fullName: 'Admin User', email, currentPassword: password })
      : await agent.patch(path).send({ email, currentPassword: password });
    const normalized = email.trim().toLowerCase();
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ loginChanged: true, passwordChanged: false, user: { email: normalized } });
    expect(response.body.user.email.length).toBeLessThanOrEqual(254);
    const executor = path.endsWith('settings') ? client.query : mocks.pool.query;
    expect(executor).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "session"'), ['7', expect.any(String)]);
    expect(executor).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM saved_accounts'), [7]);
    expect((await agent.get('/api/auth/session')).body).toMatchObject({ kind: 'user', user: { email: normalized } });
  });
  it.each(['/api/auth/me/settings', '/api/auth/me/credentials'])('retains missing/wrong-current-password protection on %s', async (path) => {
    const agent = await agentFor(); const body = { fullName: 'Admin User', email: 'golosbaxti' };
    const missing = path.endsWith('settings') ? await agent.put(path).send(body) : await agent.patch(path).send(body);
    expect(missing.status).toBe(400); expect(missing.body.error).toBe('currentPasswordRequired'); expectNoCredentialWrites();
    const wrong = path.endsWith('settings') ? await agent.put(path).send({ ...body, currentPassword: 'Wrong123' }) : await agent.patch(path).send({ ...body, currentPassword: 'Wrong123' });
    expect(wrong.status).toBe(401); expect(wrong.body).toEqual({ error: 'currentPasswordInvalid', code: 'CREDENTIAL_VALIDATION_FAILED' });
    expectNoCredentialWrites(); expect((await agent.get('/api/auth/session')).body.kind).toBe('user');
  });
  it.each(['', ...invalidLogins])('rejects invalid own settings/credentials input %j before any credential write', async (email) => {
    const agent = await agentFor();
    const settings = await agent.put('/api/auth/me/settings').send({ fullName: 'Admin User', email, currentPassword: password });
    const credentials = await agent.patch('/api/auth/me/credentials').send({ email, currentPassword: password });
    for (const response of [settings, credentials]) { expect(response.status).toBe(400); expect(response.body.error).toBe(email === '' ? 'loginRequired' : 'invalidLogin'); }
    expectNoCredentialWrites();
  });
  it('keeps own credential case-insensitive duplicates and atomic settings duplicate rollback', async () => {
    users.get(20)!.email = 'golosbaxti'; const agent = await agentFor();
    const credentials = await agent.patch('/api/auth/me/credentials').send({ email: 'GOLOSbaxti', currentPassword: password });
    expect(credentials.status).toBe(400); expect(credentials.body.error).toBe('loginAlreadyExists'); expectNoCredentialWrites();
    const original = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('UPDATE users')) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_email_unique' });
      return original(sql, params);
    });
    const settings = await agent.put('/api/auth/me/settings').send({ fullName: 'Admin User', email: 'GOLOSbaxti', currentPassword: password });
    expect(settings.status).toBe(409); expect(settings.body.error).toBe('loginAlreadyExists');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK'); expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(users.get(7)!.email).toBe('admin@example.com'); expect((await agent.get('/api/auth/session')).body.kind).toBe('user');
  });
  it.each(['  GOLOSbaxti  ', '  Admin User  '])('authenticates plain identifier or retained full-name fallback %j and resolves its session', async (login) => {
    users.get(7)!.email = 'golosbaxti'; const agent = request.agent(app);
    const response = await agent.post('/api/auth/login').send({ login, password });
    expect(response.status).toBe(200); expect(mocks.storage.getUserByLoginOrEmail).toHaveBeenCalledWith(login.trim());
    expect(response.body.user.password).toBeUndefined();
    const resolved = await agent.get('/api/auth/session');
    expect(resolved.status).toBe(200); expect(resolved.body).toMatchObject({ kind: 'user', user: { id: 7, email: 'golosbaxti' } });
    expect(resolved.body.user.password).toBeUndefined();
  });
});
