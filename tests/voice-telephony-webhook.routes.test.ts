import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/config', () => ({ appConfig: { integrations: { onlinePbx: { webhookSecret: 'test-only-webhook-token' } } }, isDevelopmentEnvironment: false, isProductionEnvironment: false }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: vi.fn() } }));
import { createTelephonyRouter } from '../server/routes/telephony.routes';

describe('robot callbacks are excluded before manager contact and KPI handling', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue({ rows: [] }); });
  const makeApp = (observe: (payload: Record<string, unknown>) => Promise<boolean>) => {
    const app = express(); app.use(express.json()); app.use('/telephony', createTelephonyRouter(observe));
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(503).json({ error: 'Unavailable' }));
    return app;
  };
  it('authenticates first and acknowledges repeated robot callbacks without touching manager data', async () => {
    const observer = vi.fn(async () => true); const app = makeApp(observer);
    expect((await request(app).post('/telephony/webhook').send({ uuid: 'test-robot-call' })).status).toBe(401);
    expect(observer).not.toHaveBeenCalled();
    for (let index = 0; index < 2; index++) {
      expect((await request(app).post('/telephony/webhook').set('x-webhook-secret', 'test-only-webhook-token').send({ uuid: 'test-robot-call', event: 'call_end' })).status).toBe(200);
    }
    expect(observer).toHaveBeenCalledTimes(2); expect(mocks.query).not.toHaveBeenCalled();
  });
  it('retries observer failures instead of attributing an unknown robot to a manager', async () => {
    const app = makeApp(async () => { throw new Error('Temporary database failure'); });
    expect((await request(app).post('/telephony/webhook').set('x-webhook-secret', 'test-only-webhook-token').send({ uuid: 'test-robot-call' })).status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('preserves the ordinary webhook path for calls outside the robot receipts', async () => {
    const app = makeApp(async () => false);
    expect((await request(app).post('/telephony/webhook').set('x-webhook-secret', 'test-only-webhook-token').send({ uuid: 'test-human-call', caller: '100' })).status).toBe(200);
    expect(mocks.query).toHaveBeenCalled();
  });
});
