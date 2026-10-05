import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  viewer: { id: 1, module: 'administration', modules: ['administration', 'sales'] } as {
    id: number; module: string; modules: string[];
  } | null,
}));

vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: vi.fn() } }));
vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: ((req, res, next) => {
    if (!mocks.viewer) return res.status(401).json({ error: 'Unauthorized' });
    req.user = mocks.viewer as never;
    next();
  }) satisfies RequestHandler,
}));

import telephonyRoutes from '../server/routes/telephony.routes';
import { buildUnresolvedMissedCallSql, telephonyCallVisibilityCondition } from '../server/services/telephony-notifications';

const app = express();
app.use('/api/telephony', telephonyRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer = { id: 1, module: 'administration', modules: ['administration', 'sales'] };
  mocks.query.mockResolvedValue({ rows: [] });
});

describe('telephony widget call history', () => {
  it('returns the unassigned callback queue visible to an administrator in both the count and list', async () => {
    const calls = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, userId: null, status: 'missed' }));
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT COUNT(*)') ? [{ count: calls.length }] : calls,
    }));

    const summary = await request(app).get('/api/telephony/calls/missed/unread');
    const history = await request(app).get('/api/telephony/calls?filter=missed&limit=50');

    expect(summary.status).toBe(200);
    expect(history.status).toBe(200);
    expect(history.body).toEqual(calls);
    expect(history.body).toHaveLength(summary.body.count);
    const [sql, params] = mocks.query.mock.calls[1];
    expect(sql).toContain(`WHERE ${telephonyCallVisibilityCondition(mocks.viewer!)}`);
    expect(sql).toContain(buildUnresolvedMissedCallSql('call'));
    expect(sql).not.toContain('WHERE user_id = $1');
    expect(params).toEqual([50, 0]);
  });

  it('uses the same visibility as the counter for a sales employee, including calls to their leads', async () => {
    mocks.viewer = { id: 7, module: 'sales', modules: ['sales'] };
    await request(app).get('/api/telephony/calls?filter=missed');

    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain(`WHERE ${telephonyCallVisibilityCondition(mocks.viewer)}`);
    expect(sql).toContain('lead.manager_id = $1');
    expect(sql).toContain('assignment.funnel_id = lead.funnel_id');
    expect(params).toEqual([7, 30, 0]);
  });

  it('filters before paginating so older missed calls remain reachable', async () => {
    await request(app).get('/api/telephony/calls?filter=missed&limit=50&offset=100');
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql.indexOf(buildUnresolvedMissedCallSql('call'))).toBeLessThan(sql.indexOf('LIMIT'));
    expect(sql).toContain('ORDER BY call.started_at DESC, call.id DESC');
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(params).toEqual([50, 100]);
  });

  it('keeps incoming and outgoing filters inside the employee visibility boundary', async () => {
    mocks.viewer = { id: 7, module: 'sales', modules: ['sales'] };
    await request(app).get('/api/telephony/calls?filter=incoming&limit=50&offset=50');
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain(telephonyCallVisibilityCondition(mocks.viewer));
    expect(sql).toContain('call.direction = $2');
    expect(params).toEqual([7, 'incoming', 50, 50]);
  });

  it('rejects an unsupported filter before querying calls', async () => {
    expect((await request(app).get('/api/telephony/calls?filter=unknown')).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('requires an authenticated employee with access to sales', async () => {
    mocks.viewer = { id: 2, module: 'teacher', modules: ['teacher'] };
    expect((await request(app).get('/api/telephony/calls')).status).toBe(403);
    mocks.viewer = null;
    expect((await request(app).get('/api/telephony/calls')).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
