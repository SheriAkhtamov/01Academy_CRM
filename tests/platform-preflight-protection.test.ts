import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const limits = vi.hoisted(() => ({ mutation: vi.fn(), read: vi.fn() }));
vi.mock('../server/config', () => ({
  appConfig: { server: { appUrl: 'https://academy.example' } },
  isProductionEnvironment: true,
  isDevelopmentEnvironment: false,
}));
vi.mock('../server/middleware/rateLimiter', () => ({
  globalMutationLimiter: (req: Request, res: Response, next: NextFunction) => { limits.mutation(); next(); },
  readLimiter: (req: Request, res: Response, next: NextFunction) => { limits.read(); next(); },
}));
import { createHttpApp } from '../server/app/http-app';
import { createPlatformAuthRouter } from '../server/routes/platform-auth.routes';

beforeEach(() => vi.clearAllMocks());
it('exempts only the rate-protected exact preflight POST from shared mutation limits', async () => {
  const app = createHttpApp();
  app.use('/api/auth', createPlatformAuthRouter({ verifyStaff: async () => false, verifyPortal: async () => true }));
  app.all('*', (_req, res) => res.json({ ok: true }));
  await request(app).post('/api/auth/login-realm').set('X-Requested-With', 'XMLHttpRequest').send({ identifier: 'student', password: 'ValidPassword123!' }).expect(200);
  expect(limits.mutation).not.toHaveBeenCalled();
  await request(app).post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({}).expect(200);
  await request(app).post('/api/auth/login-realm-extra').set('X-Requested-With', 'XMLHttpRequest').send({}).expect(200);
  await request(app).put('/api/auth/login-realm').set('X-Requested-With', 'XMLHttpRequest').send({}).expect(200);
  expect(limits.mutation).toHaveBeenCalledTimes(3);
  await request(app).get('/api/auth/login-realm').expect(200);
  expect(limits.read).toHaveBeenCalledTimes(1);
});
