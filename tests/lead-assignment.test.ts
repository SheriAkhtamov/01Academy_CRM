import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorContextFrom } from '../server/modules/leads/domain/actor-context';
import { toApiErrorKey } from '../server/lib/apiErrorKeys';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), updateRow: vi.fn(), insertRow: vi.fn(),
  createNotification: vi.fn(), createAudit: vi.fn(), withTransaction: vi.fn(),
  applyLeadVisibilityForActor: vi.fn(),
}));
vi.mock('../server/modules/academy/academy-core', () => ({
  ...mocks, salesUserAccessSql: 'true',
  leadPhoneNumbersSelect: () => 'NULL AS phone_numbers',
  leadChannelsSelect: () => 'NULL AS channels',
  leadTagsSelect: () => 'NULL AS tags',
  leadGroupReservationsSelect: () => 'NULL AS group_reservations',
}));
vi.mock('../server/modules/academy/sales-funnel-policy', () => ({ assertSalesFunnelAssignment: vi.fn() }));
vi.mock('../server/modules/academy/academy-scheduling', () => ({ TEMPLATE_SOURCE_PREFIXES: [] }));
vi.mock('../server/services/meta-marketing', () => ({ enqueueMetaConversionForLead: vi.fn() }));
vi.mock('../server/services/lead-view-state', () => ({ leadViewStateAfterManagerTransfer: () => ({}) }));

import { reassignLead } from '../server/modules/academy/academy-leads';
import { assertSalesFunnelAssignment } from '../server/modules/academy/sales-funnel-policy';
import { LegacyLeadAssignmentRepository } from '../server/modules/leads/infrastructure/legacy-assignment-repository';

const salesperson = {
  ...actorContextFrom({ id: 18, module: 'sales' }),
  salesWorkflow: { role: 'full_cycle', hunterFunnelId: 1, closerFunnelId: 3, assignedFunnelIds: [1, 3] },
};
const freeLead = { id: 2718, contactName: 'Parent', funnelId: 3, managerId: null, statusCode: 'demo_attended' };

describe('locked lead assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withTransaction.mockImplementation(async (operation: () => unknown) => operation());
    mocks.query.mockResolvedValue([]);
    mocks.queryOne.mockImplementation(async (sql: string, params: number[]) => sql.includes('FROM users')
      ? { id: params[0], fullName: 'Manager' } : freeLead);
    mocks.updateRow.mockResolvedValue({ ...freeLead, managerId: 18 });
    mocks.applyLeadVisibilityForActor.mockImplementation(async (_actor, leads) => leads);
  });

  it('claims the closer queue without allowing general edits before ownership', async () => {
    await expect(reassignLead(salesperson, freeLead, { id: 18, fullName: 'Manager' }))
      .resolves.toMatchObject({ id: 2718, managerId: 18 });
    expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [2718]);
    expect(assertSalesFunnelAssignment).toHaveBeenCalledWith(3, 18);
    expect(mocks.insertRow).toHaveBeenCalledWith('academy_lead_assignment_history', expect.objectContaining({
      leadId: 2718, fromManagerId: null, toManagerId: 18, changedBy: 18,
    }));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE academy_students'), [18, 2718]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE academy_tasks'), [18, 2718]);
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });

  it('allows the ordinary assignment repository to claim an unassigned closer lead', async () => {
    await expect(new LegacyLeadAssignmentRepository().assign(2718, 18, salesperson))
      .resolves.toMatchObject({ managerId: 18 });
    expect(mocks.createAudit).toHaveBeenCalledWith(salesperson, 'ASSIGN_ACADEMY_LEAD',
      'academy_lead', 2718, expect.objectContaining({ managerId: 18 }), freeLead);
  });

  it('rejects assigning a free lead to someone else at the repository entry point', async () => {
    await expect(new LegacyLeadAssignmentRepository().assign(2718, 7, salesperson))
      .rejects.toMatchObject({ statusCode: 403, message: 'accessDenied' });
    expect(mocks.updateRow).not.toHaveBeenCalled();
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it('rejects a stale claim when another employee took the lead before the row lock', async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: 18, fullName: 'Manager' })
      .mockResolvedValueOnce({ ...freeLead, managerId: 7 });
    await expect(reassignLead(salesperson, freeLead, { id: 18, fullName: 'Manager' }))
      .rejects.toMatchObject({ statusCode: 403, message: 'accessDenied' });
    expect(mocks.updateRow).not.toHaveBeenCalled();
    expect(mocks.insertRow).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it('rejects transfer of an owned lead to another employee inside the shared assignment helper', async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: 7, fullName: 'Other manager' })
      .mockResolvedValueOnce({ ...freeLead, managerId: 18 });
    await expect(reassignLead(salesperson, { ...freeLead, managerId: 18 }, { id: 7, fullName: 'Other manager' }))
      .rejects.toMatchObject({ statusCode: 403, message: 'accessDenied' });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('preserves leadership transfer of owned leads', async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: 18, fullName: 'Manager' })
      .mockResolvedValueOnce({ ...freeLead, managerId: 7 });
    await expect(reassignLead(actorContextFrom({ id: 1, module: 'administration' }), freeLead, { id: 18, fullName: 'Manager' }))
      .resolves.toMatchObject({ managerId: 18 });
  });

  it('keeps repeat self-assignment idempotent without new assignment history or notification', async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: 18, fullName: 'Manager' })
      .mockResolvedValueOnce({ ...freeLead, managerId: 18 });
    await expect(reassignLead(salesperson, freeLead, { id: 18, fullName: 'Manager' }))
      .resolves.toMatchObject({ managerId: 18 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
    expect(mocks.insertRow).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it('does not translate access requirements as missing form fields', () => {
    expect(toApiErrorKey('Lead mutation access required')).toBe('accessDenied');
    expect(toApiErrorKey('Lead assignment access required')).toBe('accessDenied');
    expect(toApiErrorKey('Contact name is required')).toBe('fillRequiredFields');
  });
});
