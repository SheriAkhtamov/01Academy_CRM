import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(), queryOne: vi.fn(), query: vi.fn(), createAudit: vi.fn(), withTransaction: vi.fn(),
  getActiveSalesManager: vi.fn(), reassignLead: vi.fn(),
}));
vi.mock('../server/db', () => ({ pool: { query: mocks.poolQuery } }));
vi.mock('../server/infrastructure/sales-kpi/kpi-repository', () => ({
  kpiError: (error: Error, statusCode = 400) => Object.assign(error, { statusCode }),
}));
vi.mock('../server/modules/academy/academy-core', () => mocks);
vi.mock('../server/modules/academy/academy-leads', () => mocks);

import { claimKpiLead, readKpiLeadOwnership } from '../server/infrastructure/sales-kpi/kpi-handoff';

const actor = { id: 18, isAdministration: false };
const source = { id: 18, module: 'sales' };
const lead = { id: 15, managerId: null, workflowRole: 'closer', isArchived: false, funnelId: 3 };

describe('closer queue claims with full-cycle KPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withTransaction.mockImplementation(async (operation: () => unknown) => operation());
    mocks.getActiveSalesManager.mockResolvedValue({ id: 18, fullName: 'Employee' });
    mocks.reassignLead.mockResolvedValue({ ...lead, managerId: 18 });
    mocks.query.mockResolvedValue([]);
  });

  it.each(['closer', 'full_cycle', 'full_cycle_3500'])('allows %s to claim an unassigned closer lead', async (role) => {
    mocks.queryOne.mockResolvedValueOnce({ role }).mockResolvedValueOnce(lead);
    await expect(claimKpiLead(actor, source, 15)).resolves.toEqual({ id: 15 });
    expect(mocks.reassignLead).toHaveBeenCalledWith(source, lead, { id: 18, fullName: 'Employee' }, expect.any(String));
    expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [15]);
  });

  it.each(['closer', 'full_cycle', 'full_cycle_3500'])('offers claiming in ownership details to %s', async (role) => {
    mocks.poolQuery.mockResolvedValue({ rows: [{
      manager_id: null, workflow_role: 'closer', actor_role: role, is_archived: false,
      hunter_id: 7, hunter_name: 'Hunter', closer_id: null, offer_at: null,
    }] });
    await expect(readKpiLeadOwnership(actor, 15)).resolves.toMatchObject({ inCloserQueue: true, canClaim: true });
  });

  it('does not let a hunter claim a closer lead', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'hunter' });
    await expect(claimKpiLead(actor, source, 15)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.reassignLead).not.toHaveBeenCalled();
  });

  it('does not steal a lead assigned to another employee', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'full_cycle' }).mockResolvedValueOnce({ ...lead, managerId: 7 });
    await expect(claimKpiLead(actor, source, 15)).rejects.toMatchObject({ statusCode: 409, message: 'closerLeadAlreadyClaimed' });
    expect(mocks.reassignLead).not.toHaveBeenCalled();
  });

  it('keeps repeated own claims idempotent', async () => {
    mocks.queryOne.mockResolvedValueOnce({ role: 'full_cycle' }).mockResolvedValueOnce({ ...lead, managerId: 18 });
    await expect(claimKpiLead(actor, source, 15)).resolves.toEqual({ id: 15 });
    expect(mocks.reassignLead).not.toHaveBeenCalled();
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });
});
