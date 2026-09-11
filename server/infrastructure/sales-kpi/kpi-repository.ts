import { pool } from '../../db';
import type { PoolClient } from 'pg';
import { KPI_ROLES, parseKpiPlanConfig, type KpiPlanConfig, type KpiPlanVersion, type KpiRole } from '@shared/sales-kpi';
import { kpiMonth, nextKpiMonth } from '@shared/sales-kpi-time';
import { readEmployeeKpiAssignments } from './employee-assignments';

export type KpiActor = { id: number; isAdministration: boolean };
export const kpiError = (error: Error, statusCode = 400) => Object.assign(error, { statusCode });
export async function kpiTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
type PlanRow = { id: number; role: KpiRole; effective_month: string; config: unknown; created_at: Date; created_by: number | null };
const mapPlan = (row: PlanRow): KpiPlanVersion => ({
  id: row.id, role: row.role, effectiveMonth: row.effective_month,
  config: parseKpiPlanConfig(row.role, row.config), createdAt: row.created_at.toISOString(), createdBy: row.created_by,
});

export async function listKpiPlans() {
  const [{ rows }, { rows: activeRoles }] = await Promise.all([
    pool.query<PlanRow>('SELECT * FROM academy_sales_kpi_plans ORDER BY effective_month DESC, id DESC'),
    pool.query<{ role: KpiRole }>(`SELECT DISTINCT role FROM academy_sales_kpi_assignments
      WHERE effective_month <= $1 AND role IS NOT NULL`, [kpiMonth()]),
  ]);
  const month = kpiMonth();
  const minimumEffectiveMonth = Object.fromEntries(KPI_ROLES.map((role) => [
    role,
    activeRoles.some((row) => row.role === role) ? nextKpiMonth(month) : month,
  ])) as Record<KpiRole, string>;
  return { versions: rows.map(mapPlan), currentMonth: month, minimumEffectiveMonth };
}

const roleLock = (role: KpiRole) => KPI_ROLES.indexOf(role) + 1;

export async function saveKpiPlan(actorId: number, role: KpiRole, config: KpiPlanConfig, effectiveMonth: string, expectedVersionId: number) {
  return kpiTransaction(async (client) => {
    const validatedConfig = parseKpiPlanConfig(role, config);
    await client.query('SELECT pg_advisory_xact_lock(10402, $1)', [roleLock(role)]);
    const { rows: [last] } = await client.query<PlanRow>(
      'SELECT * FROM academy_sales_kpi_plans WHERE role = $1 ORDER BY id DESC LIMIT 1', [role],
    );
    if (!last || last.id !== expectedVersionId) throw kpiError(new Error('kpiVersionConflict'), 409);
    // Once used, even a currently unassigned system must retain its history.
    const { rows: historical } = await client.query(
      'SELECT 1 FROM academy_sales_kpi_assignments WHERE role = $1 AND effective_month <= $2 LIMIT 1', [role, kpiMonth()],
    );
    const minimum = historical.length ? nextKpiMonth(kpiMonth()) : kpiMonth();
    if (effectiveMonth < minimum) throw kpiError(new Error('kpiFutureRulesRequired'));
    const { rows: [created] } = await client.query<PlanRow>(
      `INSERT INTO academy_sales_kpi_plans (role, effective_month, config, created_by)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING *`, [role, effectiveMonth, JSON.stringify(validatedConfig), actorId],
    );
    await client.query(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
      VALUES ($1, 'UPDATE_SALES_KPI_PLAN', 'sales_kpi_plan', $2, $3::jsonb, $4::jsonb)`,
    [actorId, created.id, JSON.stringify(last), JSON.stringify(created)]);
    return mapPlan(created);
  });
}

export async function getKpiReportingEmployees(month: string, managerId: number | null) {
  const { rows } = await pool.query<{ id: number; name: string; role: KpiRole; assignedAt: Date }>(
    `SELECT employee.id, employee.full_name AS name, assignment.role, assignment.created_at AS "assignedAt"
     FROM users employee JOIN LATERAL (
       SELECT role, created_at FROM academy_sales_kpi_assignments
       WHERE user_id = employee.id AND effective_month <= $1 ORDER BY effective_month DESC LIMIT 1
     ) assignment ON assignment.role IS NOT NULL
     WHERE ($2::int IS NULL OR employee.id = $2) ORDER BY employee.full_name, employee.id`, [month, managerId],
  );
  return rows.map((row) => ({ ...row, assignedAt: row.assignedAt.toISOString() }));
}

export async function listKpiAssignments() {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users');
  return readEmployeeKpiAssignments(pool, rows.map((row) => row.id));
}

export { mapPlan };
