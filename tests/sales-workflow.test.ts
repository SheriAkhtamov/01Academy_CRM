import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesFunnelStages, stagesForSalesFunnel } from '../shared/sales-funnel-workflow';
import { actorContextFrom, type ActorContext } from '../server/modules/leads/domain/actor-context';
import { canActorAssignLead, canActorMutateLead, canActorViewLead } from '../server/modules/leads/domain/access-policy';
const mocks = vi.hoisted(() => ({ query: vi.fn(), createStageHistory: vi.fn(), queryOne: vi.fn(), createAudit: vi.fn(), withTransaction: vi.fn(),
  getActiveSalesManager: vi.fn(), reassignLead: vi.fn(), assertSalesFunnelAssignment: vi.fn(), resolveInitialLeadStatusCode: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);
vi.mock('../server/modules/academy/sales-funnel-policy', () => mocks);
import { handoffKpiLead } from '../server/infrastructure/sales-kpi/kpi-handoff';
const employee = (role: string, userId: number): ActorContext => ({ ...actorContextFrom({ id: userId, module: 'sales' }),
  salesWorkflow: { role, hunterFunnelId: 1, closerFunnelId: 2, assignedFunnelIds: [1, 2], defaultFunnelId: 1,
    defaultInitialStageCode: 'intake_a', autoLeadDistributionEnabled: false } });
const actor = employee('hunter', 7);
const lead = { id: 10, funnelId: 1, managerId: 7, statusCode: 'arbitrary' };
describe('generic funnel stage visibility', () => {
  it('filters by explicit funnel ownership and order, regardless of legacy code or KPI role', () => {
    const stages = [{ code: 'paid', sortOrder: 10, funnelId: 1 }, { code: 'demo_attended', sortOrder: 20, funnelId: 1 },
      { code: 'new_request', sortOrder: 0, funnelId: 2 }, { code: 'hidden', sortOrder: 30, funnelId: 1, isPipeline: false }];
    expect(salesFunnelStages(stages, 'closer', 1).map(s => s.code)).toEqual(['paid', 'demo_attended']);
    expect(salesFunnelStages(stages, 'hunter', 2).map(s => s.code)).toEqual(['new_request']);
    expect(stagesForSalesFunnel(stages, null, 1).map(s => s.code)).toEqual(['paid', 'demo_attended', 'hidden']);
  });
  it.each(['hunter', 'closer', 'full_cycle'])('allows %s to use each explicitly assigned funnel, and no peer-owned leads', (role) => {
    const user = employee(role, 7);
    for (const funnelId of [1, 2]) {
      expect(canActorViewLead(user, { ...lead, funnelId, managerId: null })).toBe(true);
      expect(canActorAssignLead(user, { ...lead, funnelId, managerId: null }, 7)).toBe(true);
      expect(canActorViewLead(user, { ...lead, funnelId, managerId: 8 })).toBe(false);
      expect(canActorMutateLead(user, { ...lead, funnelId, managerId: 8 })).toBe(false);
    }
    expect(canActorViewLead(user, { ...lead, funnelId: 99, managerId: null })).toBe(false);
  });
  it('keeps automatic intake private while showing the assigned employee their own intake', () => {
    const user = { ...actor, salesWorkflow: { ...actor.salesWorkflow!, autoLeadDistributionEnabled: true } };
    expect(canActorViewLead(user, { funnelId: 1, managerId: null, statusCode: 'intake_a' })).toBe(false);
    expect(canActorViewLead(user, { funnelId: 1, managerId: 7, statusCode: 'intake_a' })).toBe(true);
  });
});
describe('explicit transfer between funnels', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.withTransaction.mockImplementation(async (callback) => callback());
    mocks.resolveInitialLeadStatusCode.mockResolvedValue('intake_b');
  });
  it.each(['hunter', 'closer', 'full_cycle'])('preserves the %s owner and enters the chosen destination intake without qualification', async (role) => {
    mocks.queryOne.mockResolvedValueOnce(lead).mockResolvedValueOnce({ id: 2, workflowRole: 'closer' })
      .mockResolvedValueOnce({ ...lead, funnelId: 2, statusCode: 'intake_b' });
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, employee(role, 7), 10, 2))
      .resolves.toEqual({ id: 10, mode: 'transfer', funnelId: 2 });
    expect(mocks.assertSalesFunnelAssignment).toHaveBeenCalledWith(2, 7);
    expect(mocks.resolveInitialLeadStatusCode).toHaveBeenCalledWith(null, 2);
    expect(mocks.queryOne).toHaveBeenLastCalledWith(expect.stringContaining('status_code = $3'), [10, 2, 'intake_b']);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('qualifications'))).toBe(false);
  });
  it('requires an explicit destination instead of choosing by a stage or KPI role', async () => {
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, actor, 10))
      .rejects.toMatchObject({ message: 'salesFunnelRequired' });
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });
  it('rechecks current ownership under lock before transfer', async () => {
    mocks.queryOne.mockResolvedValueOnce({ ...lead, managerId: 8 });
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, actor, 10, 2))
      .rejects.toMatchObject({ message: 'accessDenied', statusCode: 403 });
    expect(mocks.assertSalesFunnelAssignment).not.toHaveBeenCalled();
  });
});
