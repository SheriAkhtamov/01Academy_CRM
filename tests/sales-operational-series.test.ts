import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({ ...db, ACADEMY_TIME_ZONE: 'Asia/Tashkent' }));
vi.mock('../server/modules/academy/academy-scheduling', () => ({}));
import { buildSalesDashboardMetrics } from '../server/modules/academy/sales-dashboard-metrics';
const range = { from: '2026-08-01', to: '2026-08-03', start: new Date('2026-07-31T19:00:00Z'), end: new Date('2026-08-03T19:00:00Z') };
beforeEach(() => db.queryOne.mockReset().mockResolvedValue({}));
describe('sales report scope', () => {
  it('pins ordinary employees to their own data even when called with another manager', async () => {
    await buildSalesDashboardMetrics({ userId: 7, module: 'sales' }, range, 999, 4);
    expect(db.queryOne.mock.calls[0][1].slice(0, 4)).toEqual([range.start, range.end, 7, 4]);
  });
  it('lets leadership select a manager and funnel or all portfolios', async () => {
    await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, range);
    expect(db.queryOne.mock.calls[0][1].slice(0, 4)).toEqual([range.start, range.end, null, null]);
    await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, range, 8, 2);
    expect(db.queryOne.mock.calls[1][1].slice(0, 4)).toEqual([range.start, range.end, 8, 2]);
  });
  it('returns a measured zero report without fabricated legacy statistics', async () => {
    expect(await buildSalesDashboardMetrics({ userId: 7, module: 'sales' }, range)).toEqual({
      asOf: expect.any(String),
      reportLeads: 0,
      newLeads: 0, processedLeads: 0, reachedLeads: 0, qualifiedLeads: 0, demoBookings: 0, demoAttendees: 0,
      successfulStudents: 0, closedLeads: 0, closedReasons: [],
      contactBreakdown: { firstAttempt: 0, secondAttempt: 0, thirdAttempt: 0, laterAttempt: 0,
        incomingFirst: 0, attemptedUnreached: 0, notAttempted: 0,
        reachedArchived: 0, reachedQualifiedInWork: 0, reachedUnqualifiedInWork: 0 },
      daily: ['2026-08-01', '2026-08-02', '2026-08-03'].map(date => ({ date,
        newLeads: 0, processedLeads: 0, reachedLeads: 0, qualifiedLeads: 0,
        demoBookings: 0, demoAttendees: 0, successfulStudents: 0 })),
    });
  });
});
