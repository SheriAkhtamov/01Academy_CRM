import type { PoolClient } from 'pg';
import { kpiRoleSchema, type KpiEmployeeAssignment, type KpiRole } from '@shared/sales-kpi';
import { kpiMonth, nextKpiMonth } from '@shared/sales-kpi-time';

type Executor = Pick<PoolClient, 'query'>;
export function parseEmployeeKpiRole(value: unknown): KpiRole | null | undefined {
  if (value === undefined || value === null) return value;
  const parsed = kpiRoleSchema.safeParse(value);
  if (!parsed.success) throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  return parsed.data;
}

/** Must run in the same transaction as the employee/module write. */
export async function setEmployeeKpiAssignment(
  executor: Executor, userId: number, requested: KpiRole | null | undefined,
  modules: readonly string[], actorId: number, now = new Date(),
) {
  if (requested === undefined && modules.includes('sales')) return;
  if (!modules.includes('sales') && requested) {
    throw Object.assign(new Error('kpiSalesModuleRequired'), { statusCode: 400 });
  }
  const role = modules.includes('sales') ? requested ?? null : null;
  await executor.query('SELECT pg_advisory_xact_lock(10401, $1)', [userId]);
  const currentMonth = kpiMonth(now);
  const { rows } = await executor.query<{ role: KpiRole | null; effective_month: string }>(
    `SELECT role, effective_month FROM academy_sales_kpi_assignments
     WHERE user_id = $1 ORDER BY effective_month DESC`, [userId],
  );
  const latest = rows[0];
  if ((latest?.role ?? null) === role) return;
  // The first assignment and a rules edit must agree whether this month's
  // plan has already been used. Share the plan writer's role lock.
  if (role) await executor.query('SELECT pg_advisory_xact_lock(10402, $1)', [role === 'hunter' ? 1 : 2]);
  const hasHistory = rows.some((row) => row.effective_month <= currentMonth);
  const effectiveMonth = hasHistory ? nextKpiMonth(currentMonth) : currentMonth;
  await executor.query(
    `INSERT INTO academy_sales_kpi_assignments (user_id, effective_month, role, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, effective_month) DO UPDATE SET role = EXCLUDED.role,
       created_by = EXCLUDED.created_by, created_at = timezone('UTC', now())`,
    [userId, effectiveMonth, role, actorId],
  );
  await executor.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
     VALUES ($1, 'ASSIGN_SALES_KPI', 'user', $2, $3::jsonb, $4::jsonb)`,
    [actorId, userId, JSON.stringify(latest ?? null), JSON.stringify({ role, effectiveMonth })],
  );
  if (effectiveMonth === currentMonth && role) {
    // Capture attribution only. Historical achievements are never invented.
    await executor.query('SELECT academy_kpi_touch_lead(id) FROM academy_leads WHERE manager_id = $1', [userId]);
  }
}

export async function readEmployeeKpiAssignments(executor: Executor, userIds: number[]): Promise<KpiEmployeeAssignment[]> {
  if (userIds.length === 0) return [];
  const { rows } = await executor.query<{
    userId: number; role: KpiRole | null; effectiveMonth: string; createdAt: Date;
  }>(`SELECT user_id AS "userId", role, effective_month AS "effectiveMonth", created_at AS "createdAt"
      FROM academy_sales_kpi_assignments WHERE user_id = ANY($1::int[]) ORDER BY effective_month DESC`, [userIds]);
  const month = kpiMonth();
  return userIds.map((userId) => {
    const assignments = rows.filter((row) => row.userId === userId);
    const current = assignments.find((row) => row.effectiveMonth <= month);
    const scheduled = assignments.find((row) => row.effectiveMonth > month);
    const map = (row: typeof current) => row
      ? { role: row.role, effectiveMonth: row.effectiveMonth, createdAt: row.createdAt.toISOString() } : null;
    return { userId, current: map(current), scheduled: map(scheduled) };
  });
}
