import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('../server/modules/academy/academy-core', () => ({ query }));
vi.mock('../server/modules/academy/academy-scheduling', () => ({
  academyDateOnlyKey: (date: Date) => date.toISOString().slice(0, 10),
}));
import { buildSalesDemoAttendanceStats } from '../server/modules/academy/sales-demo-students';

describe('demo attendance is counted per student, not per parent lead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts two attending siblings as two students and never reads the lead flag or stage', async () => {
    query.mockResolvedValue([
      { studentId: 1, happenedAt: new Date('2026-09-12T05:00:00Z') },
      { studentId: 2, happenedAt: new Date('2026-09-12T05:00:00Z') },
    ]);
    const range = {
      start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z'),
      from: '2026-09-01', to: '2026-09-30',
    };
    const result = await buildSalesDemoAttendanceStats({ userId: 18, module: 'sales' }, range);
    expect(result).toEqual({ count: 2, daily: new Map([['2026-09-12', 2]]) });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('GROUP BY student_id');
    expect(sql).toContain("participant.status = 'attended'");
    expect(sql).not.toContain('demo_attended');
    expect(sql).not.toContain('status_code');
  });
});
