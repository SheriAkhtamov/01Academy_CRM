import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => db);
vi.mock('../server/modules/academy/academy-scheduling', () => ({
  academyDateOnlyKey: (value: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tashkent' }).format(value),
}));
import { buildSalesDashboardMetrics } from '../server/modules/academy/sales-dashboard-metrics';

const range = { from: '2026-08-01', to: '2026-08-03', start: new Date('2026-07-31T19:00:00Z'), end: new Date('2026-08-03T19:00:00Z') };

beforeEach(() => {
  vi.resetAllMocks();
  db.queryOne.mockResolvedValue({ demoBookings: 3, repeatCallLeads: 4, repeatCallDistribution: [{ attempts: 2, count: 3 }, { attempts: 5, count: 1 }] });
  db.query.mockImplementation(async (sql: string) => sql.includes('MIN(history.entered_at)') ? [
    { happenedAt: '2026-07-31T19:00:00Z' }, { happenedAt: '2026-08-01T08:00:00Z' }, { happenedAt: '2026-08-03T18:59:59Z' },
  ] : sql.includes('MIN(scheduled_at)') ? [
    { studentId: 1, happenedAt: '2026-07-31T19:00:00Z' }, { studentId: 2, happenedAt: '2026-08-03T18:59:59Z' },
  ] : []);
});

describe('operational chart series', () => {
  it('aligns unique-lead booking days and call-attempt buckets with the headline totals', async () => {
    const result = await buildSalesDashboardMetrics({ userId: 7, module: 'sales' }, range, 999);
    expect(result.daily.map(({ date, demoBookings }) => ({ date, demoBookings }))).toEqual([
      { date: '2026-08-01', demoBookings: 2 }, { date: '2026-08-02', demoBookings: 0 }, { date: '2026-08-03', demoBookings: 1 },
    ]);
    expect(result.daily.reduce((sum, day) => sum + day.demoBookings, 0)).toBe(result.demoBookings);
    expect(result.demoAttendees).toBe(2);
    expect(result.daily.map(day => day.demoAttendees)).toEqual([1, 0, 1]);
    expect(result.daily.reduce((sum, day) => sum + day.demoAttendees, 0)).toBe(result.demoAttendees);
    expect(result.repeatCallDistribution.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(result.repeatCallLeads);
    const bookingRead = db.query.mock.calls.find(([sql]) => sql.includes('MIN(history.entered_at)'))!;
    expect(bookingRead[0]).toContain('GROUP BY history.lead_id');
    expect(bookingRead[0]).toContain("history.to_status_code = 'demo_invited'");
    for (const [sql, values] of [...db.query.mock.calls, ...db.queryOne.mock.calls]) {
      expect(sql).toContain(sql.includes('attended_demos') ? 'END = $3' : 'THEN tracked.closer_id ELSE tracked.hunter_id');
      expect(values[2]).toBe(7);
    }
  });

  it('lets leadership select one employee or aggregate all employees in the same range', async () => {
    await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, range);
    for (const [sql, values] of db.query.mock.calls) {
      expect(sql).not.toContain('AND lead.manager_id = $3');
      if (!sql.includes('attended_demos')) expect(values).toEqual([range.start, range.end]);
      else expect(values[2]).toBeNull();
    }
    db.query.mockClear();
    await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, range, 8);
    for (const [, values] of db.query.mock.calls) expect(values[2]).toBe(8);
  });

  it('returns empty measured series without inventing bookings or attempts', async () => {
    db.queryOne.mockResolvedValue({});
    db.query.mockResolvedValue([]);
    const result = await buildSalesDashboardMetrics({ userId: 7, module: 'sales' }, range);
    expect(result.demoBookings).toBe(0);
    expect(result.demoAttendees).toBe(0);
    expect(result.repeatCallLeads).toBe(0);
    expect(result.repeatCallDistribution).toEqual([]);
    expect(result.daily.map((day) => day.demoBookings)).toEqual([0, 0, 0]);
  });
});
