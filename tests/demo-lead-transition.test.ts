import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), handleLeadStatusEffects: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);
import { transitionDemoLead } from '../server/modules/academy/demo-lead-transition';

const lead = { id: 12, managerId: 18, funnelId: 1, statusCode: 'demo_invited' };
const teacher = { id: 4, module: 'teacher' };

describe('shared atomic demo transition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the recorder as history author, never as the new manager', async () => {
    mocks.queryOne.mockResolvedValue({ ...lead, statusCode: 'demo_attended', funnelId: 3 });
    await expect(transitionDemoLead(teacher, lead, 'demo_attended', true, 9, 'Attendance'))
      .resolves.toMatchObject({ managerId: 18, funnelId: 3 });
    expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining('academy_transition_demo_lead'),
      [12, 'demo_attended', true, 9, 4, 'Attendance']);
    expect(mocks.handleLeadStatusEffects).toHaveBeenCalledWith(teacher,
      expect.objectContaining({ managerId: 18 }), 'demo_invited');
  });

  it('does not repeat stage side effects for an idempotent result', async () => {
    mocks.queryOne.mockResolvedValue(lead);
    await transitionDemoLead(teacher, lead, 'demo_invited', false, 9, 'Reset');
    expect(mocks.handleLeadStatusEffects).not.toHaveBeenCalled();
  });

  it.each([['invalidLeadStatus', 409], ['salesFunnelRequired', 409], ['resourceNotFound', 404], ['accessDenied', 403]])
    ('preserves the HTTP status for database error %s', async (message, statusCode) => {
      mocks.queryOne.mockRejectedValue(Object.assign(new Error(message), { code: 'P0001' }));
      await expect(transitionDemoLead(teacher, lead, 'demo_attended', true, 9, 'Attendance'))
        .rejects.toMatchObject({ message, statusCode });
      expect(mocks.handleLeadStatusEffects).not.toHaveBeenCalled();
    });
});
