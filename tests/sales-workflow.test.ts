import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesFunnelStages, stagesForSalesFunnel } from '../shared/sales-funnel-workflow';
import { actorContextFrom, type ActorContext } from '../server/modules/leads/domain/actor-context';
import { canActorAssignLead, canActorMutateLead, canActorViewLead } from '../server/modules/leads/domain/access-policy';
import { canManageDemoParticipant } from '../server/modules/academy/demo-participant-access';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  insertRow: vi.fn(),
  updateRow: vi.fn(),
  createAudit: vi.fn(),
  createStageHistory: vi.fn(),
  handleLeadStatusEffects: vi.fn(),
  syncLeadManagerRelations: vi.fn(),
  withTransaction: vi.fn(),
  transitionDemoLead: vi.fn(),
  assertSalesFunnelAssignment: vi.fn(),
  assertSalesFunnelStage: vi.fn(),
}));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);
vi.mock('../server/modules/academy/demo-lead-transition', () => mocks);
vi.mock('../server/modules/academy/sales-funnel-policy', () => ({
  assertSalesFunnelAssignment: mocks.assertSalesFunnelAssignment,
  assertSalesFunnelStage: mocks.assertSalesFunnelStage,
}));
import { handoffKpiLead } from '../server/infrastructure/sales-kpi/kpi-handoff';

const employee = (role: string, userId: number): ActorContext => ({ ...actorContextFrom({ id: userId, module: 'sales' }),
  salesWorkflow: {
    role,
    hunterFunnelId: 1,
    closerFunnelId: 2,
    defaultFunnelId: 1,
    assignedFunnelIds: role === 'closer' ? [2] : role.startsWith('full_cycle') ? [1, 2, 3] : [1, 3],
    autoLeadDistributionEnabled: false,
  } });
const hunter = employee('hunter', 7);
const closer = employee('closer', 8);
const fullCycle = employee('full_cycle', 9);
const fullCycle3500 = employee('full_cycle_3500', 10);
const lead = { id: 10, funnelId: 1, managerId: 7, statusCode: 'demo_invited' };

describe('hunter/closer pipeline and permissions', () => {
  it('starts the closer board with demo attendance and isolates the hunter stages', () => {
    const stages = [{ code: 'paid', sortOrder: 0 }, { code: 'demo_attended', sortOrder: 50 },
      { code: 'new_request', sortOrder: 999 }, { code: 'ne_prishli_na_vstrechu', sortOrder: 45 },
      { code: 'custom_before', sortOrder: 40 }, { code: 'custom_after', sortOrder: 60 }];
    expect(salesFunnelStages(stages, 'closer').map((stage) => stage.code)).toEqual(['demo_attended', 'paid', 'custom_after']);
    expect(salesFunnelStages(stages, 'hunter').map((stage) => stage.code)).toEqual(['custom_before', 'ne_prishli_na_vstrechu', 'new_request']);
  });
  it('keeps custom stages in their selected funnel and shows hidden stages in settings', () => {
    const stages = [
      { code: 'new_request', sortOrder: 10, isPipeline: true },
      { code: 'demo_attended', sortOrder: 90, isPipeline: true },
      { code: 'hunter_custom', sortOrder: 150, funnelId: 1, isPipeline: true },
      { code: 'b2b_custom', sortOrder: 160, funnelId: 2, isPipeline: false },
    ];
    expect(salesFunnelStages(stages, 'hunter', 1).map((stage) => stage.code))
      .toEqual(['new_request', 'hunter_custom']);
    expect(salesFunnelStages(stages, 'closer', 3).map((stage) => stage.code))
      .toEqual(['demo_attended']);
    expect(stagesForSalesFunnel(stages, null, 2).map((stage) => stage.code))
      .toEqual(['new_request', 'demo_attended', 'b2b_custom']);
  });
  it('exposes the queue only to closers and requires claiming before mutations', () => {
    const queue = { ...lead, funnelId: 2, managerId: null };
    expect(canActorViewLead(hunter, queue)).toBe(false);
    expect(canActorViewLead(closer, queue)).toBe(true);
    expect(canActorMutateLead(closer, queue)).toBe(false);
    expect(canActorMutateLead(closer, { ...queue, managerId: 8 })).toBe(true);
    expect(canActorViewLead(employee('closer', 9), { ...queue, managerId: 8 })).toBe(false);
    expect(canActorViewLead(closer, { ...queue, funnelId: 1 })).toBe(false);
    expect(canActorViewLead(hunter, { ...queue, funnelId: 3 })).toBe(true);
    expect(canActorViewLead(hunter, { ...queue, funnelId: 4 })).toBe(false);
    expect(canActorViewLead(fullCycle, { ...queue, managerId: 9 })).toBe(true);
    expect(canActorMutateLead(fullCycle, { ...queue, managerId: 9 })).toBe(true);
    expect(canActorViewLead(fullCycle, { ...lead, managerId: 9 })).toBe(true);
    expect(canActorViewLead(fullCycle3500, { ...queue, managerId: 10 })).toBe(true);
    expect(actorContextFrom({ actor: closer } as never)).toBe(closer);
  });
  it('retains hunter attendance access after the queue handoff', () => {
    const participant = { managerId: 8, attendanceManagerId: 7, funnelRole: 'closer' };
    expect(canManageDemoParticipant(hunter, participant)).toBe(true);
    expect(canManageDemoParticipant(closer, participant)).toBe(true);
    expect(canManageDemoParticipant(employee('hunter', 9), participant)).toBe(false);
    expect(canManageDemoParticipant(employee('hunter', 9), { ...participant, managerId: null })).toBe(false);
  });
  it('lets closers and full-cycle employees take only free leads in assigned funnels', () => {
    const queue = { ...lead, funnelId: 2, managerId: null };
    for (const actor of [closer, fullCycle, fullCycle3500]) {
      expect(canActorAssignLead(actor, queue, actor.userId)).toBe(true);
      expect(canActorMutateLead(actor, queue)).toBe(false);
      expect(canActorAssignLead(actor, { ...queue, managerId: 99 }, actor.userId)).toBe(false);
      expect(canActorAssignLead(actor, { ...queue, managerId: actor.userId }, 99)).toBe(false);
      expect(canActorAssignLead(actor, { ...queue, funnelId: 99 }, actor.userId)).toBe(false);
    }
    expect(canActorAssignLead(hunter, queue, hunter.userId)).toBe(false);
    expect(canActorAssignLead(hunter, { ...queue, funnelId: 1 }, hunter.userId)).toBe(true);
    const administration = actorContextFrom({ id: 1, module: 'administration' });
    expect(canActorAssignLead(administration, { ...queue, managerId: 7 }, 8)).toBe(true);
  });
});

describe('manual continuation keeps the existing owner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.withTransaction.mockImplementation(async (callback: () => unknown) => callback());
    mocks.query.mockResolvedValue([]);
    mocks.transitionDemoLead.mockImplementation(async (_actor, previous) => ({ ...previous, funnelId: 2, statusCode: 'demo_attended' }));
  });

  it('lets a hunter continue their lead without releasing ownership', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' })
      .mockResolvedValueOnce({ ...lead, workflowRole: 'hunter' });

    await expect(handoffKpiLead({ id: 7, isAdministration: false }, hunter, 10)).resolves.toEqual({ id: 10, mode: 'continue' });

    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(hunter, expect.objectContaining({ managerId: 7 }),
      'demo_attended', null, null, expect.any(String));
    expect(mocks.createAudit).toHaveBeenCalledWith(hunter, 'CONTINUE_FULL_CYCLE_LEAD', 'academy_lead', 10,
      { funnelId: 2, managerId: 7 }, { funnelId: 1, managerId: 7 });
    expect(mocks.syncLeadManagerRelations).not.toHaveBeenCalled();
    expect(mocks.insertRow).not.toHaveBeenCalled();
  });

  it('uses the selected closer funnel for the existing post-demo transition', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' })
      .mockResolvedValueOnce({ ...lead, workflowRole: 'hunter' })
      .mockResolvedValueOnce({ id: 2, workflowRole: 'closer' });

    await expect(handoffKpiLead({ id: 7, isAdministration: false }, hunter, 10, 2))
      .resolves.toEqual({ id: 10, mode: 'continue' });

    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(hunter, expect.objectContaining({ managerId: 7 }),
      'demo_attended', null, null, expect.any(String));
  });

  it('moves the owned lead to a selected regular funnel without changing its stage or owner', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' })
      .mockResolvedValueOnce({ ...lead, workflowRole: 'hunter' })
      .mockResolvedValueOnce({ id: 3, workflowRole: null })
      .mockResolvedValueOnce({ ...lead, funnelId: 3 });

    await expect(handoffKpiLead({ id: 7, isAdministration: false }, hunter, 10, 3))
      .resolves.toEqual({ id: 10, mode: 'transfer', funnelId: 3 });

    expect(mocks.assertSalesFunnelAssignment).toHaveBeenCalledWith(3, 7);
    expect(mocks.assertSalesFunnelStage).toHaveBeenCalledWith(3, 'demo_invited');
    expect(mocks.queryOne).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE academy_leads'), [10, 3]);
    expect(mocks.transitionDemoLead).not.toHaveBeenCalled();
    expect(mocks.createAudit).toHaveBeenCalledWith(hunter, 'TRANSFER_LEAD_FUNNEL', 'academy_lead', 10,
      { funnelId: 3, managerId: 7 }, { funnelId: 1, managerId: 7 });
  });

  it('moves an owned lead from a regular funnel to another funnel', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' })
      .mockResolvedValueOnce({ ...lead, funnelId: 3, workflowRole: null })
      .mockResolvedValueOnce({ id: 4, workflowRole: null })
      .mockResolvedValueOnce({ ...lead, funnelId: 4 });

    await expect(handoffKpiLead({ id: 7, isAdministration: false }, hunter, 10, 4))
      .resolves.toEqual({ id: 10, mode: 'transfer', funnelId: 4 });

    expect(mocks.assertSalesFunnelAssignment).toHaveBeenCalledWith(4, 7);
    expect(mocks.assertSalesFunnelStage).toHaveBeenCalledWith(4, 'demo_invited');
    expect(mocks.transitionDemoLead).not.toHaveBeenCalled();
  });

  it('moves a closer-owned lead from the closer funnel to a regular funnel', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'closer' })
      .mockResolvedValueOnce({ ...lead, funnelId: 2, managerId: 8, statusCode: 'demo_attended', workflowRole: 'closer' })
      .mockResolvedValueOnce({ id: 3, workflowRole: null })
      .mockResolvedValueOnce({ ...lead, funnelId: 3, managerId: 8 });

    await expect(handoffKpiLead({ id: 8, isAdministration: false }, closer, 10, 3))
      .resolves.toEqual({ id: 10, mode: 'transfer', funnelId: 3 });

    expect(mocks.assertSalesFunnelAssignment).toHaveBeenCalledWith(3, 8);
    expect(mocks.assertSalesFunnelStage).toHaveBeenCalledWith(3, 'demo_attended');
    expect(mocks.transitionDemoLead).not.toHaveBeenCalled();
  });

  it('rejects a closer and a hunter who does not own the lead', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'closer' });
    await expect(handoffKpiLead({ id: 8, isAdministration: false }, closer, 10))
      .rejects.toMatchObject({ message: 'salesFunnelHunterOnly', statusCode: 403 });

    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' })
      .mockResolvedValueOnce({ ...lead, managerId: 9, workflowRole: 'hunter' });
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, hunter, 10))
      .rejects.toMatchObject({ message: 'accessDenied', statusCode: 403 });
    expect(mocks.transitionDemoLead).not.toHaveBeenCalled();
  });

  it('moves a full-cycle owner to the closer funnel without releasing the lead', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'full_cycle' })
      .mockResolvedValueOnce({ ...lead, managerId: 9, workflowRole: 'hunter' });

    await expect(handoffKpiLead({ id: 9, isAdministration: false }, fullCycle, 10))
      .resolves.toEqual({ id: 10, mode: 'continue' });
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(fullCycle, expect.objectContaining({ managerId: 9 }),
      'demo_attended', null, null, expect.any(String));
    expect(mocks.createAudit).toHaveBeenCalledWith(fullCycle, 'CONTINUE_FULL_CYCLE_LEAD', 'academy_lead', 10,
      { funnelId: 2, managerId: 9 }, { funnelId: 1, managerId: 9 });
  });

  it('keeps an administrator with the 3.5m full-cycle role assigned to their own lead', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'full_cycle_3500' })
      .mockResolvedValueOnce({ ...lead, managerId: 10, workflowRole: 'hunter' });

    await expect(handoffKpiLead({ id: 10, isAdministration: true }, fullCycle3500, 10))
      .resolves.toEqual({ id: 10, mode: 'continue' });
    expect(mocks.transitionDemoLead).toHaveBeenCalledWith(fullCycle3500, expect.objectContaining({ managerId: 10 }),
      'demo_attended', null, null, expect.any(String));
  });

  it('preserves the owner when an administrator continues someone else\'s lead', async () => {
    const admin = actorContextFrom({ id: 1, module: 'administration' });
    mocks.queryOne.mockResolvedValueOnce({ role: null }).mockResolvedValueOnce({ ...lead, workflowRole: 'hunter' });
    await expect(handoffKpiLead({ id: 1, isAdministration: true }, admin, 10)).resolves.toEqual({ id: 10, mode: 'continue' });
    expect(mocks.createAudit).toHaveBeenCalledWith(admin, 'CONTINUE_FULL_CYCLE_LEAD', 'academy_lead', 10,
      { funnelId: 2, managerId: 7 }, { funnelId: 1, managerId: 7 });
  });
});
