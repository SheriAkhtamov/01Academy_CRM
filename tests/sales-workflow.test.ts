import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesFunnelStages } from '../shared/sales-funnel-workflow';
import { actorContextFrom, type ActorContext } from '../server/modules/leads/domain/actor-context';
import { canActorMutateLead, canActorViewLead } from '../server/modules/leads/domain/access-policy';
import { canManageDemoParticipant } from '../server/modules/academy/demo-participant-access';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), insertRow: vi.fn(), createAudit: vi.fn(), syncLeadManagerRelations: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);
import { prepareDemoFunnelHandoff } from '../server/modules/academy/demo-funnel-handoff';

const employee = (role: string, userId: number): ActorContext => ({ ...actorContextFrom({ id: userId, module: 'sales' }),
  salesWorkflow: {
    role,
    hunterFunnelId: 1,
    closerFunnelId: 2,
    assignedFunnelIds: role === 'closer' ? [2] : [1, 3],
  } });
const hunter = employee('hunter', 7);
const closer = employee('closer', 8);
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

describe('automatic demo handoff', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue([]); });
  it('freezes attribution before releasing the lead and its related owners', async () => {
    mocks.queryOne.mockResolvedValueOnce({ workflowRole: 'hunter' }).mockResolvedValueOnce({ id: 2 });
    expect(await prepareDemoFunnelHandoff(hunter, lead, 'demo_attended', 3)).toMatchObject({
      funnelId: 2, managerId: null, statusCode: 'demo_attended', firstViewedAt: null,
    });
    expect(mocks.query.mock.calls[0]).toEqual(['SELECT academy_kpi_touch_lead($1)', [10]]);
    expect(mocks.syncLeadManagerRelations).toHaveBeenCalledWith(10, null);
    expect(mocks.insertRow).toHaveBeenCalledWith('academy_lead_assignment_history', expect.objectContaining({ fromManagerId: 7, toManagerId: null }));
  });
  it('does not requeue an already claimed lead on attendance retry', async () => {
    mocks.queryOne.mockResolvedValueOnce({ workflowRole: 'closer' });
    expect(await prepareDemoFunnelHandoff(hunter, { ...lead, funnelId: 2, managerId: 8 }, 'demo_attended', 3))
      .toEqual({ statusCode: 'demo_attended', demoAttended: true });
    expect(mocks.syncLeadManagerRelations).not.toHaveBeenCalled();
  });
  it('does not undo another real attendance when a later demo was missed', async () => {
    mocks.queryOne.mockResolvedValueOnce({ workflowRole: 'closer' }).mockResolvedValueOnce({ id: 4 });
    expect(await prepareDemoFunnelHandoff(hunter, { ...lead, funnelId: 2, managerId: null }, 'ne_prishli_na_vstrechu', 3))
      .toEqual({ statusCode: 'demo_attended', demoAttended: true });
  });
  it('returns an unclaimed mistaken attendance to its previous active hunter', async () => {
    mocks.queryOne.mockResolvedValueOnce({ workflowRole: 'closer' }).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ fromFunnelId: 1, fromManagerId: 7, activeManagerId: 7 });
    expect(await prepareDemoFunnelHandoff(hunter, { ...lead, funnelId: 2, managerId: null }, 'ne_prishli_na_vstrechu', 3))
      .toMatchObject({ funnelId: 1, managerId: 7, demoAttended: false });
  });
  it('does not revoke a claimed deal when correcting attendance', async () => {
    mocks.queryOne.mockResolvedValueOnce({ workflowRole: 'closer' }).mockResolvedValueOnce(null);
    expect(await prepareDemoFunnelHandoff(hunter, { ...lead, funnelId: 2, managerId: 8, statusCode: 'demo_attended' }, 'ne_prishli_na_vstrechu', 3))
      .toEqual({ statusCode: 'demo_attended', demoAttended: false });
    expect(mocks.syncLeadManagerRelations).not.toHaveBeenCalled();
  });
});
