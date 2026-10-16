import express from 'express';
import session from 'express-session';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlatformAuthRouter } from '../server/routes/platform-auth.routes';
import { PortalIdentityService } from '../server/modules/portal-identity/application/identity-service';
import { createPortalCrypto } from '../server/modules/portal-identity/infrastructure/crypto';
import { MemoryPortalRepository } from './portal-identity-memory';

const mocks = vi.hoisted(() => ({ staff: vi.fn() }));
vi.mock('../server/services/auth', () => ({ authService: {
  authenticateUser: mocks.staff,
  sanitizeUser: (user: Record<string, unknown>) => { const { password: _password, ...safe } = user; return safe; },
} }));
vi.mock('../server/storage', () => ({ storage: {} }));
vi.mock('../server/db', () => ({ pool: { query: vi.fn() } }));
import staffRoutes from '../server/routes/auth.routes';

const employee = { id: 7, email: 'employee', fullName: 'Employee', password: 'private-hash', module: 'sales', isActive: true, isArchived: false };
const credentials = (identifier: string, preferredRealm: 'staff' | 'portal' = 'staff', password = 'ValidPassword123!') => ({ identifier, password, preferredRealm });
let address = 1;
const createApp = (portal = vi.fn(async (identifier: string, password: string) => identifier.startsWith('student') && password === 'ValidPassword123!'), enabled = true) => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({ secret: 'platform-login-realm-unit-tests', resave: false, saveUninitialized: false }));
  app.use('/api/auth', createPlatformAuthRouter({
    verifyStaff: async (identifier, password) => Boolean(await mocks.staff(identifier, password)),
    verifyPortal: enabled ? portal : undefined,
  }));
  app.use('/api/auth', staffRoutes);
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => response.status(500).json({ error: 'loginFailedMessage' }));
  const ip = `203.0.113.${address++}`;
  const proof = (body: Record<string, unknown>) => request(app).post('/api/auth/login-realm').set('X-Forwarded-For', ip).send(body);
  const staffLogin = () => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ login: 'employee', password: 'ValidPassword123!' });
  return { app, proof, staffLogin, portal };
};
beforeEach(() => {
  mocks.staff.mockReset().mockImplementation(async (identifier: string, password: string) =>
    identifier === 'employee' && password === 'ValidPassword123!' ? employee : null);
});

describe('common platform credential realm selection', () => {
  it('allows more than 30 valid students from one IP and then a valid employee without spending staff login attempts', async () => {
    const { proof, staffLogin } = createApp();
    for (let index = 1; index <= 35; index++) {
      const resolved = await proof(credentials(`student-${index}`)).expect(200);
      expect(resolved.body).toEqual({ realm: 'portal' });
      expect(resolved.headers['set-cookie']).toBeUndefined();
    }
    const loggedIn = await staffLogin().expect(200);
    expect(loggedIn.body.user.id).toBe(7);
    expect(loggedIn.body.user.password).toBeUndefined();
    expect(loggedIn.headers['set-cookie']).toBeDefined();
  });

  it('permits more than five valid sign-ins for the same learning identifier', async () => {
    const { proof } = createApp();
    for (let index = 0; index < 8; index++) expect((await proof(credentials('student-repeat'))).body).toEqual({ realm: 'portal' });
  });

  it('retains the failed-attempt limit without exposing whether an identifier exists', async () => {
    const { proof, portal } = createApp();
    for (let index = 0; index < 5; index++) {
      const failure = await proof(credentials('student-real', 'staff', 'wrong')).expect(401);
      expect(failure.body).toEqual({ error: 'invalidCredentialsMessage' });
    }
    const limited = await proof(credentials('student-real', 'portal')).expect(429);
    expect(limited.headers['cache-control']).toBe('private, no-store');
    expect(portal).toHaveBeenCalledTimes(5);
  });

  it('retains the IP limit across different invalid or unknown identifiers', async () => {
    const { proof } = createApp();
    for (let index = 0; index < 30; index++) await proof(credentials(`unknown-${index}`)).expect(401);
    await proof(credentials('unknown-final')).expect(429);
  });

  it.each(['staff', 'portal'] as const)('honors %s priority only after credentials have been verified in a colliding namespace', async (preferredRealm) => {
    mocks.staff.mockResolvedValue(employee);
    const { proof } = createApp(vi.fn(async () => true));
    const resolved = await proof(credentials('shared-login', preferredRealm)).expect(200);
    expect(resolved.body).toEqual({ realm: preferredRealm });
    expect(resolved.headers['set-cookie']).toBeUndefined();
    expect(resolved.headers['cache-control']).toBe('private, no-store');
  });

  it('selects valid learning credentials after a same-name employee password fails without calling the employee login handler', async () => {
    const portal = vi.fn(async (identifier: string, password: string) => identifier === 'employee' && password === 'ParentPassword123!');
    const { proof, staffLogin } = createApp(portal);
    for (let index = 0; index < 8; index++) {
      await proof(credentials('employee', 'staff', 'ParentPassword123!')).expect(200, { realm: 'portal' });
    }
    await staffLogin().expect(200);
  });

  it('excludes the learning realm when the feature is disabled', async () => {
    const { proof, portal } = createApp(undefined, false);
    await proof(credentials('employee', 'portal')).expect(200, { realm: 'staff' });
    await proof(credentials('student-1')).expect(401);
    expect(portal).not.toHaveBeenCalled();
  });

  it('does not turn a verifier failure into a successful login in another realm', async () => {
    mocks.staff.mockRejectedValue(new Error('Unavailable'));
    const { proof, portal } = createApp(vi.fn(async () => true));
    await proof(credentials('shared-login')).expect(500);
    expect(portal).not.toHaveBeenCalled();
  });

  it('rejects malformed commands without verifying or issuing a session', async () => {
    const { proof, portal } = createApp();
    const invalid = await proof({ identifier: 'employee', password: 'ValidPassword123!', preferredRealm: 'administration' }).expect(400);
    expect(invalid.headers['set-cookie']).toBeUndefined();
    expect(mocks.staff).not.toHaveBeenCalled(); expect(portal).not.toHaveBeenCalled();
  });

  it('verifies a learning password without creating sessions, consuming realm limits or granting permissions', async () => {
    const repository = new MemoryPortalRepository();
    const crypto = createPortalCrypto(Buffer.alloc(32, 1).toString('base64'));
    const account = await repository.createAccount({ login: 'student-1', fullName: 'Student', email: null, phone: null, locale: 'en', status: 'active', passwordHash: await bcrypt.hash('ValidPassword123!', 1), authVersion: 1 });
    const identity = new PortalIdentityService(repository, crypto, { appUrl: 'https://academy.example', allowInvitations: false });
    const rate = vi.spyOn(repository, 'rateLimit');
    const sessions = vi.spyOn(repository, 'saveSession');
    const audits = vi.spyOn(repository, 'audit');
    expect(await identity.verifyLoginCredentials(' STUDENT-1 ', 'ValidPassword123!')).toBe(true);
    expect(await identity.verifyLoginCredentials('student-1', 'WrongPassword123!')).toBe(false);
    expect(await identity.verifyLoginCredentials('student-1', 'x'.repeat(73))).toBe(false);
    await repository.updateAccount(account.id, { status: 'suspended' });
    expect(await identity.verifyLoginCredentials('student-1', 'ValidPassword123!')).toBe(true);
    expect(rate).not.toHaveBeenCalled();
    mocks.staff.mockResolvedValue(employee);
    const { proof } = createApp(vi.fn((identifier, password) => identity.verifyLoginCredentials(identifier, password)));
    await proof(credentials('student-1', 'portal')).expect(200, { realm: 'portal' });
    expect(mocks.staff).not.toHaveBeenCalled();
    await expect(identity.login('student-1', 'ValidPassword123!', 'test-ip')).rejects.toMatchObject({ status: 401 });
    expect(sessions).not.toHaveBeenCalled(); expect(audits).not.toHaveBeenCalled();
  });
});
