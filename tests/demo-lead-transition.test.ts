import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
import { recordDemoLeadAttendance } from '../server/modules/academy/demo-lead-transition';
const lead = { id: 12, managerId: 18, funnelId: 1, statusCode: 'custom' };
describe('demo attendance records facts independently of funnel stages', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([true, false])('records attendance %s without selecting a stage, funnel or manager', async (attended) => {
    mocks.queryOne.mockResolvedValue({ ...lead, demoAttended: attended });
    await expect(recordDemoLeadAttendance({ id: 4, module: 'teacher' }, lead, attended))
      .resolves.toMatchObject({ ...lead, demoAttended: attended });
    const [sql, values] = mocks.queryOne.mock.calls[0];
    expect(values).toEqual([12, attended]);
    expect(sql).toContain('SET demo_attended = $2');
    expect(sql).not.toMatch(/SET\s+(?:status_code|funnel_id|manager_id)|academy_transition_demo_lead/);
  });
  it('reports a missing parent without inventing a stage transition', async () => {
    mocks.queryOne.mockResolvedValue(undefined);
    await expect(recordDemoLeadAttendance({ id: 4, module: 'teacher' }, lead, true))
      .rejects.toMatchObject({ message: 'resourceNotFound', statusCode: 404 });
  });
});
