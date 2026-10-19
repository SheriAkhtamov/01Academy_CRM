import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesFunnelStages, stagesForSalesFunnel } from '../shared/sales-funnel-workflow';
import { actorContextFrom, type ActorContext } from '../server/modules/leads/domain/actor-context';
import { canActorAssignLead, canActorMutateLead, canActorViewLead } from '../server/modules/leads/domain/access-policy';
const mocks = vi.hoisted(() => ({ query: vi.fn(), createStageHistory: vi.fn(), queryOne: vi.fn(), createAudit: vi.fn(), withTransaction: vi.fn(),
  getActiveSalesManager: vi.fn(), reassignLead: vi.fn(), assertSalesFunnelAssignment: vi.fn(), resolveInitialLeadStatusCode: vi.fn(),
  syncLeadManagerRelations: vi.fn(), insertRow: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);
vi.mock('../server/modules/academy/sales-funnel-policy', () => mocks);
import { handoffKpiLead } from '../server/infrastructure/sales-kpi/kpi-handoff';
const employee = (_role: string, userId: number): ActorContext => ({ ...actorContextFrom({ id: userId, module: 'sales' }),
  salesWorkflow: { assignedFunnelIds: [1, 2] } });
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
      expect(canActorMutateLead(user, { ...lead, funnelId, managerId: null })).toBe(false);
      expect(canActorMutateLead(user, { ...lead, funnelId })).toBe(true);
      expect(canActorViewLead(user, { ...lead, funnelId, managerId: 8 })).toBe(false);
      expect(canActorMutateLead(user, { ...lead, funnelId, managerId: 8 })).toBe(false);
    }
    expect(canActorViewLead(user, { ...lead, funnelId: 99, managerId: null })).toBe(false);
  });
  it('keeps an unassigned intake visible regardless of incoming distribution settings', () => {
    const user = actor;
    expect(canActorViewLead(user, { funnelId: 1, managerId: null, statusCode: 'intake_a' })).toBe(true);
    expect(canActorViewLead(user, { funnelId: 1, managerId: 7, statusCode: 'intake_a' })).toBe(true);
    expect(canActorViewLead(user, { funnelId: 99, managerId: null, statusCode: 'intake_a' })).toBe(false);
  });
});
describe('explicit transfer between funnels', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.withTransaction.mockImplementation(async (callback) => callback());
    mocks.resolveInitialLeadStatusCode.mockResolvedValue('intake_b');
  });
  it.each(['hunter', 'closer', 'full_cycle'])('preserves the %s owner and enters the chosen destination intake without qualification', async (role) => {
    mocks.queryOne.mockResolvedValueOnce({ managerId: 7 }).mockResolvedValueOnce(lead)
      .mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ userId: 7 })
      .mockResolvedValueOnce({ ...lead, funnelId: 2, statusCode: 'intake_b' });
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, employee(role, 7), 10, 2))
      .resolves.toEqual({ id: 10, mode: 'transfer', funnelId: 2 });
    expect(mocks.assertSalesFunnelAssignment).not.toHaveBeenCalled();
    expect(mocks.resolveInitialLeadStatusCode).toHaveBeenCalledWith(null, 2);
    expect(mocks.queryOne).toHaveBeenLastCalledWith(expect.stringContaining('status_code = $3'), [10, 2, 'intake_b', 7]);
    expect(mocks.syncLeadManagerRelations).toHaveBeenCalledWith(10, 7);
    expect(mocks.insertRow).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('qualifications'))).toBe(false);
  });
  it('requires an explicit destination instead of choosing by a stage or KPI role', async () => {
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, actor, 10))
      .rejects.toMatchObject({ message: 'salesFunnelRequired' });
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });
  it('rechecks current ownership under lock before transfer', async () => {
    mocks.queryOne.mockResolvedValueOnce({ managerId: 8 }).mockResolvedValueOnce({ ...lead, managerId: 8 });
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, actor, 10, 2))
      .rejects.toMatchObject({ message: 'accessDenied', statusCode: 403 });
    expect(mocks.assertSalesFunnelAssignment).not.toHaveBeenCalled();
  });
  it('synchronizes the released owner when the previous manager is not in the destination', async () => {
    const managerId = null;
    mocks.queryOne.mockResolvedValueOnce({ managerId: 7 }).mockResolvedValueOnce(lead)
      .mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...lead, funnelId: 2, managerId, statusCode: 'intake_b' });
    await handoffKpiLead({ id: 7, isAdministration: false }, actor, 10, 2);
    expect(mocks.queryOne).toHaveBeenLastCalledWith(expect.stringContaining('manager_id = $4'), [10, 2, 'intake_b', null]);
    expect(mocks.syncLeadManagerRelations).toHaveBeenCalledWith(10, managerId);
    expect(mocks.insertRow).toHaveBeenCalledWith('academy_lead_assignment_history', expect.objectContaining({
      leadId: 10, fromManagerId: 7, toManagerId: managerId, changedBy: 7,
    }));
    expect(mocks.createAudit).toHaveBeenCalledWith(actor, 'TRANSFER_LEAD_FUNNEL', 'academy_lead', 10,
      { funnelId: 2, managerId }, { funnelId: 1, managerId: 7 });
  });
  it('rejects archived leads even for administration', async () => {
    mocks.queryOne.mockResolvedValueOnce({ managerId: 7 }).mockResolvedValueOnce({ ...lead, isArchived: true });
    await expect(handoffKpiLead({ id: 1, isAdministration: true }, actor, 10, 2))
      .rejects.toMatchObject({ message: 'accessDenied', statusCode: 403 });
    expect(mocks.createStageHistory).not.toHaveBeenCalled();
  });
  it.each([undefined, { id: 1 }])('rejects a destination that was withdrawn or is the current funnel', async (target) => {
    mocks.queryOne.mockResolvedValueOnce({ managerId: 7 }).mockResolvedValueOnce(lead).mockResolvedValueOnce(target);
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, actor, 10, 2)).rejects.toMatchObject({
      message: target ? 'invalidData' : 'salesFunnelRequired',
    });
    expect(mocks.resolveInitialLeadStatusCode).not.toHaveBeenCalled();
  });
  it('does not transfer after a concurrent administrator assignment changes the locked employee', async () => {
    mocks.queryOne.mockResolvedValueOnce({ managerId: 7 }).mockResolvedValueOnce({ ...lead, managerId: 8 });
    await expect(handoffKpiLead({ id: 1, isAdministration: true }, actor, 10, 2))
      .rejects.toMatchObject({ message: 'invalidData', statusCode: 409 });
    expect(mocks.createStageHistory).not.toHaveBeenCalled();
  });
  it('enters an explicitly chosen destination stage instead of forcing intake', async () => {
    mocks.queryOne.mockResolvedValueOnce({ managerId: 7 }).mockResolvedValueOnce(lead)
      .mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ userId: 7 })
      .mockResolvedValueOnce({ code: 'arbitrary_destination' })
      .mockResolvedValueOnce({ ...lead, funnelId: 2, statusCode: 'arbitrary_destination' });
    await handoffKpiLead({ id: 7, isAdministration: false }, actor, 10, 2, 'arbitrary_destination');
    expect(mocks.resolveInitialLeadStatusCode).not.toHaveBeenCalled();
    expect(mocks.queryOne).toHaveBeenLastCalledWith(expect.stringContaining('status_code = $3'), [10, 2, 'arbitrary_destination', 7]);
    expect(mocks.createStageHistory).toHaveBeenCalledWith(10, 'arbitrary', 'arbitrary_destination', 7,
      expect.any(String), { fromFunnelId: 1, toFunnelId: 2 });
  });
  it('rejects a removed or foreign destination stage under lock', async () => {
    mocks.queryOne.mockResolvedValueOnce({ managerId: 7 }).mockResolvedValueOnce(lead)
      .mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ userId: 7 }).mockResolvedValueOnce(undefined);
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, actor, 10, 2, 'foreign_stage'))
      .rejects.toMatchObject({ message: 'salesFunnelStageUnavailable', statusCode: 409 });
    expect(mocks.queryOne).toHaveBeenLastCalledWith(expect.stringContaining('FOR SHARE'), ['foreign_stage', 2]);
    expect(mocks.createStageHistory).not.toHaveBeenCalled();
  });
  it.each([true, false])('requires ownership before transferring an unassigned source lead (funnel member: %s)', async isAssigned => {
    const unassigned = { ...lead, managerId: null, isAssigned };
    mocks.queryOne.mockResolvedValueOnce({ managerId: null }).mockResolvedValueOnce(unassigned)
      .mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ ...unassigned, funnelId: 2, statusCode: 'intake_b' });
    const result = handoffKpiLead({ id: 7, isAdministration: false }, actor, 10, 2);
    await expect(result).rejects.toMatchObject(isAssigned
      ? { message: 'leadAssignmentRequired', statusCode: 409 }
      : { message: 'accessDenied', statusCode: 403 });
    expect(mocks.syncLeadManagerRelations).not.toHaveBeenCalled();
    expect(mocks.createStageHistory).not.toHaveBeenCalled();
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });
});
