import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), createAudit: vi.fn(), recordDemoLeadAttendance: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/demo-lead-transition', () => mocks);
import { lockDemoParticipantLeads, syncDemoLeadStatuses } from '../server/modules/academy/demo-lead-status';
const actor = { id: 4, module: 'teacher' };
const lead = { id: 12, funnelId: 1, managerId: 18, statusCode: 'any_label', demoAttended: false };
describe('demo attendance never changes sales labels or ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.recordDemoLeadAttendance.mockImplementation(async (_actor, previous, attended) => ({ ...previous, demoAttended: attended }));
  });
  it.each(['offer', 'thinking', 'enrolled', 'paid', 'not_now', 'arbitrary'])('keeps stage %s and the original funnel/owner after attendance', async (statusCode) => {
    mocks.query.mockResolvedValueOnce([{ id: 3, status: 'completed', statuses: ['attended', 'no_show'] }]);
    const previous = { ...lead, statusCode };
    await syncDemoLeadStatuses(actor, 3, [previous], true);
    expect(mocks.recordDemoLeadAttendance).toHaveBeenCalledWith(actor, previous, true);
    expect(mocks.createAudit.mock.calls[0][4]).toMatchObject({ statusCode, funnelId: 1, demoAttended: true });
  });
  it.each([{ demos: [] }, { demos: [{ id: 3, status: 'completed', statuses: ['no_show', 'invited'] }] },
    { demos: [{ id: 3, status: 'not_conducted', statuses: ['attended'] }] }])('clears an outdated attendance fact after correction: $demos', async ({ demos }) => {
    mocks.query.mockResolvedValueOnce(demos);
    const previous = { ...lead, demoAttended: true };
    await syncDemoLeadStatuses(actor, 3, [previous], true);
    expect(mocks.recordDemoLeadAttendance).toHaveBeenCalledWith(actor, previous, false);
  });
  it('preserves a newer real outcome when an older demo is edited', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 9, status: 'completed', statuses: ['attended'] }, { id: 3, status: 'completed', statuses: ['no_show'] }]);
    await syncDemoLeadStatuses(actor, 3, [lead], true);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY demo.scheduled_at DESC, demo.id DESC'), [12, 3, true]);
    expect(mocks.recordDemoLeadAttendance).toHaveBeenCalledWith(actor, lead, true);
  });
  it('does not repeat unchanged audit writes', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 3, status: 'completed', statuses: ['attended'] }]);
    await syncDemoLeadStatuses(actor, 3, [{ ...lead, demoAttended: true }]);
    expect(mocks.recordDemoLeadAttendance).not.toHaveBeenCalled();
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });
  it('locks parents in stable order before participant writes', async () => {
    await lockDemoParticipantLeads(3, [5, 6]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY lead.id FOR UPDATE OF lead'), [3, [5, 6]]);
  });
});
