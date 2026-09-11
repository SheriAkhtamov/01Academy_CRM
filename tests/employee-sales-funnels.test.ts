import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createUserSchema } from '../client/src/features/employees/employeeFormSchema';
import { syncUserSalesFunnels } from '../server/routes/user-sales-funnel-support';

const migration = readFileSync(
  new URL('../migrations/0108_assign_employees_to_sales_funnels.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const funnelSchema = readFileSync(
  new URL('../server/db/schema/sales-funnels.ts', import.meta.url),
  'utf8',
);
const employeePage = readFileSync(
  new URL('../client/src/pages/admin.tsx', import.meta.url),
  'utf8',
);

const employee = {
  email: '',
  fullName: 'Sales Employee',
  phoneNumbers: ['+998901234567'],
  dateOfBirth: '',
  position: '',
  module: 'sales' as const,
  modules: ['sales' as const],
  salesKpiRole: 'hunter' as const,
};

describe('employee sales funnel assignments', () => {
  it('requires a funnel whenever Sales access is enabled', () => {
    expect(createUserSchema((key) => key).safeParse({
      ...employee,
      salesFunnelIds: [],
    }).success).toBe(false);
    expect(createUserSchema((key) => key).safeParse({
      ...employee,
      salesFunnelIds: [1, 2],
    }).success).toBe(true);
  });

  it('stores assignments, backfills existing access, and enforces lead ownership', () => {
    expect(migration).toContain('CREATE TABLE academy_sales_funnel_users');
    expect(migration).toContain('CROSS JOIN academy_sales_funnels funnel');
    expect(migration).toContain("RAISE EXCEPTION 'salesFunnelNotAssigned'");
    expect(funnelSchema).toContain("pgTable('academy_sales_funnel_users'");
    expect(journal.entries.filter((entry) => entry.idx === 108)).toEqual([
      expect.objectContaining({ tag: '0108_assign_employees_to_sales_funnels' }),
    ]);
  });

  it('replaces assignments atomically after validating selected funnels and owned leads', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM academy_sales_funnels')) return { rows: [{ id: 2 }] };
      if (statement.includes('COUNT(*)::int AS count')) return { rows: [{ count: 0 }] };
      return { rows: [], rowCount: 1 };
    });

    await expect(syncUserSalesFunnels({ query } as never, 7, ['sales'], [2])).resolves.toEqual([2]);
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM academy_sales_funnel_users WHERE user_id = $1',
      [7],
    );
    expect(query.mock.calls.some(([statement]) => (
      statement.includes('INSERT INTO academy_sales_funnel_users')
    ))).toBe(true);
  });

  it('does not remove funnel access while the employee still owns leads there', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM academy_sales_funnels')) return { rows: [{ id: 2 }] };
      if (statement.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
      return { rows: [], rowCount: 1 };
    });

    await expect(syncUserSalesFunnels({ query } as never, 7, ['sales'], [2]))
      .rejects.toMatchObject({ message: 'salesFunnelEmployeeHasLeads', statusCode: 409 });
    expect(query.mock.calls.some(([statement]) => statement.startsWith('DELETE'))).toBe(false);
  });

  it('always assigns both protected workflow funnels to a full-cycle employee', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM academy_sales_kpi_assignments')) return { rows: [{ role: 'full_cycle' }] };
      if (statement.includes("workflow_role IN ('hunter', 'closer')")) return { rows: [{ id: 1 }, { id: 2 }] };
      if (statement.includes('id = ANY')) return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      if (statement.includes('COUNT(*)::int AS count')) return { rows: [{ count: 0 }] };
      return { rows: [], rowCount: 1 };
    });

    await expect(syncUserSalesFunnels({ query } as never, 7, ['sales'], [3])).resolves.toEqual([3, 1, 2]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO academy_sales_funnel_users'),
      [7, [3, 1, 2]],
    );
  });

  it('keeps the funnel checklist inside the employee dialog and removes obsolete panels', () => {
    expect(employeePage).toContain('<Dialog open={showCreateUserModal}');
    expect(employeePage).toContain('name="salesFunnelIds"');
    expect(employeePage).not.toContain('personalTelephonyExtension');
    expect(employeePage).not.toContain('name="teacherAvailability"');
    expect(employeePage).not.toContain('name="teacherSchoolIds"');
  });
});
