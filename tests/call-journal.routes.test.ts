import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), viewer: { id: 1, module: 'administration', modules: ['sales', 'administration'] } as { id: number; module: string; modules: string[] } | null }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: vi.fn() } }));
vi.mock('../server/middleware/auth.middleware', () => ({ requireAuth: ((req, res, next) => {
  if (!mocks.viewer) return res.status(401).json({ error: 'Unauthorized' });
  req.user = mocks.viewer as never; next();
}) satisfies RequestHandler }));
import telephonyRoutes from '../server/routes/telephony.routes';
const app = express();
app.use('/api/telephony', telephonyRoutes);
beforeEach(() => {
  vi.clearAllMocks(); mocks.viewer = { id: 1, module: 'administration', modules: ['sales', 'administration'] };
  mocks.query.mockResolvedValue({ rows: [{ items: [], page: 1, limit: 50, total: 0, summary: { missed: 0, answered: 0, talkSeconds: 0 } }] });
});
describe('call journal route', () => {
  it('returns all six unassigned callback calls with their summary', async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, userId: null, status: 'missed', requiresCallback: true }));
    mocks.query.mockResolvedValue({ rows: [{ items, page: 1, limit: 50, total: 6, summary: { missed: 6, answered: 0, talkSeconds: 0 } }] });
    const response = await request(app).get('/api/telephony/calls/journal?status=callback');
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(items);
    expect(response.body.total).toBe(6);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE TRUE AND');
    expect(mocks.query.mock.calls[0][0]).not.toContain('call.user_id = $');
  });
  it.each(['page=2.5', 'userId=bad', 'direction=other', 'status=other', 'from=2026-02-30', 'from=2026-10-06&to=2026-10-05'])('rejects malformed %s without reading calls', async (query) => {
    expect((await request(app).get(`/api/telephony/calls/journal?${query}`)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('keeps another operator filter inside the sales employee permission scope', async () => {
    mocks.viewer = { id: 7, module: 'sales', modules: ['sales'] };
    expect((await request(app).get('/api/telephony/calls/journal?userId=8')).status).toBe(200);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('lead.manager_id = $1');
    expect(sql).toContain('call.user_id = $2');
    expect(sql).toContain('OR (call.user_id IS NULL AND');
    expect(params).toEqual([7, 8, 50, 1]);
  });
  it('rejects unauthenticated and non-sales viewers', async () => {
    mocks.viewer = null;
    expect((await request(app).get('/api/telephony/calls/journal')).status).toBe(401);
    mocks.viewer = { id: 9, module: 'teacher', modules: ['teacher'] };
    expect((await request(app).get('/api/telephony/calls/journal')).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
