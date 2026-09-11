import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesFunnelStages } from '../shared/sales-funnel-workflow';
import { actorContextFrom, type ActorContext } from '../server/modules/leads/domain/actor-context';
import { canActorMutateLead, canActorViewLead } from '../server/modules/leads/domain/access-policy';
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
}));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);
import { handoffKpiLead } from '../server/infrastructure/sales-kpi/kpi-handoff';

const employee = (role: string, userId: number): ActorContext => ({ ...actorContextFrom({ id: userId, module: 'sales' }),
  salesWorkflow: {
    role,
    hunterFunnelId: 1,
    closerFunnelId: 2,
    assignedFunnelIds: role === 'closer' ? [2] : role.startsWith('full_cycle') ? [1, 2, 3] : [1, 3],
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
});

describe('manual closer queue handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.withTransaction.mockImplementation(async (callback: () => unknown) => callback());
    mocks.query.mockResolvedValue([]);
    mocks.updateRow.mockResolvedValue({ id: 10, funnelId: 2, managerId: null, statusCode: 'demo_attended' });
  });

  it('freezes hunter attribution and releases the lead into the closer funnel', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' })
      .mockResolvedValueOnce({ ...lead, workflowRole: 'hunter' })
      .mockResolvedValueOnce({ id: 2 });

    await expect(handoffKpiLead({ id: 7, isAdministration: false }, hunter, 10)).resolves.toEqual({ id: 10, mode: 'queue' });

    expect(mocks.query.mock.calls[0]).toEqual(['SELECT academy_kpi_touch_lead($1)', [10]]);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_leads', 10, {
      funnelId: 2,
      managerId: null,
      statusCode: 'demo_attended',
      firstViewedAt: null,
      firstViewedBy: null,
    });
    expect(mocks.syncLeadManagerRelations).toHaveBeenCalledWith(10, null);
    expect(mocks.insertRow).toHaveBeenCalledWith('academy_lead_assignment_history', expect.objectContaining({
      fromManagerId: 7,
      toManagerId: null,
    }));
    expect(mocks.createStageHistory).toHaveBeenCalledWith(
      10,
      'demo_invited',
      'demo_attended',
      7,
      expect.any(String),
    );
    expect(mocks.handleLeadStatusEffects).toHaveBeenCalledOnce();
  });

  it('rejects a closer and a hunter who does not own the lead', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'closer' });
    await expect(handoffKpiLead({ id: 8, isAdministration: false }, closer, 10))
      .rejects.toMatchObject({ message: 'salesFunnelHunterOnly', statusCode: 403 });

    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' })
      .mockResolvedValueOnce({ ...lead, managerId: 9, workflowRole: 'hunter' });
    await expect(handoffKpiLead({ id: 7, isAdministration: false }, hunter, 10))
      .rejects.toMatchObject({ message: 'accessDenied', statusCode: 403 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('moves a full-cycle owner to the closer funnel without releasing the lead', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'full_cycle' })
      .mockResolvedValueOnce({ ...lead, managerId: 9, workflowRole: 'hunter' })
      .mockResolvedValueOnce({ id: 2 });
    mocks.updateRow.mockResolvedValueOnce({ id: 10, funnelId: 2, managerId: 9, statusCode: 'demo_attended' });

    await expect(handoffKpiLead({ id: 9, isAdministration: false }, fullCycle, 10))
      .resolves.toEqual({ id: 10, mode: 'continue' });
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_leads', 10, expect.objectContaining({
      funnelId: 2,
      managerId: 9,
    }));
    expect(mocks.syncLeadManagerRelations).toHaveBeenCalledWith(10, 9);
    expect(mocks.insertRow).toHaveBeenCalledWith('academy_lead_assignment_history', expect.objectContaining({
      fromManagerId: 9,
      toManagerId: 9,
    }));
  });
});
