import type { PoolClient } from 'pg';
import type { AcademyAccessModule } from '@shared/academy';
import { isFullCycleKpiRole } from '@shared/sales-kpi';

type QueryExecutor = Pick<PoolClient, 'query'>;

const positiveId = (value: unknown): number | null => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeSalesFunnelIds = (value: unknown): number[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  const funnelIds = value.map(positiveId);
  if (funnelIds.some((id) => id === null)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  return [...new Set(funnelIds as number[])];
};

export const readUserSalesFunnelIds = async (executor: QueryExecutor, userIds: number[]) => {
  const result = await executor.query<{ userId: number; funnelIds: number[] }>(
    `SELECT user_id AS "userId", array_agg(funnel_id ORDER BY funnel_id) AS "funnelIds"
     FROM academy_sales_funnel_users
     WHERE user_id = ANY($1::int[])
     GROUP BY user_id`,
    [userIds],
  );
  return new Map(result.rows.map((assignment) => [
    Number(assignment.userId),
    assignment.funnelIds.map(Number),
  ]));
};

export const syncUserSalesFunnels = async (
  executor: QueryExecutor,
  userId: number,
  modules: readonly AcademyAccessModule[],
  requestedFunnelIds: number[] | undefined,
) => {
  if (!modules.includes('sales')) {
    if (requestedFunnelIds && requestedFunnelIds.length > 0) {
      throw Object.assign(new Error('salesFunnelSalesModuleRequired'), { statusCode: 400 });
    }
    await executor.query('DELETE FROM academy_sales_funnel_users WHERE user_id = $1', [userId]);
    return [];
  }

  const latestAssignment = await executor.query<{ role: string | null }>(
    `SELECT role FROM academy_sales_kpi_assignments
     WHERE user_id = $1 ORDER BY effective_month DESC LIMIT 1`,
    [userId],
  );
  const fullCycle = isFullCycleKpiRole(latestAssignment.rows[0]?.role);
  let funnelIds = requestedFunnelIds;
  if (funnelIds === undefined) {
    const existing = await executor.query<{ funnel_id: number }>(
      'SELECT funnel_id FROM academy_sales_funnel_users WHERE user_id = $1 ORDER BY funnel_id',
      [userId],
    );
    if (existing.rows.length > 0) {
      if (!fullCycle) return existing.rows.map((row) => Number(row.funnel_id));
      funnelIds = existing.rows.map((row) => Number(row.funnel_id));
    } else {
      const defaults = await executor.query<{ id: number }>(
        `SELECT id FROM academy_sales_funnels
         WHERE is_active = true AND (workflow_role IS NULL
           OR academy_kpi_employee_role($1) IN ('full_cycle', 'full_cycle_3500')
           OR workflow_role = CASE WHEN academy_kpi_employee_role($1) = 'closer' THEN 'closer' ELSE 'hunter' END)
         ORDER BY is_default DESC, id`,
        [userId],
      );
      funnelIds = defaults.rows.map((row) => Number(row.id));
    }
  }

  if (fullCycle) {
    const workflowFunnels = await executor.query<{ id: number }>(
      `SELECT id FROM academy_sales_funnels
       WHERE is_active = true AND workflow_role IN ('hunter', 'closer')
       ORDER BY id FOR SHARE`,
    );
    funnelIds = [...new Set([...funnelIds, ...workflowFunnels.rows.map((row) => Number(row.id))])];
  }

  if (funnelIds.length === 0) throw Object.assign(new Error('salesFunnelRequired'), { statusCode: 400 });
  const available = await executor.query<{ id: number }>(
    `SELECT id FROM academy_sales_funnels
     WHERE id = ANY($1::int[]) AND is_active = true ORDER BY id FOR SHARE`,
    [funnelIds],
  );
  if (available.rows.length !== funnelIds.length) {
    throw Object.assign(new Error('salesFunnelRequired'), { statusCode: 400 });
  }
  const inaccessibleOwnedLeads = await executor.query<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count FROM academy_leads
     WHERE manager_id = $1 AND NOT (funnel_id = ANY($2::int[]))`,
    [userId, funnelIds],
  );
  const inaccessibleLeadCount = Number(inaccessibleOwnedLeads.rows[0]?.count ?? 0);
  if (inaccessibleLeadCount > 0) {
    throw Object.assign(new Error('salesFunnelEmployeeHasLeads'), {
      statusCode: 409,
      leadCount: inaccessibleLeadCount,
    });
  }

  await executor.query('DELETE FROM academy_sales_funnel_users WHERE user_id = $1', [userId]);
  await executor.query(
    `INSERT INTO academy_sales_funnel_users (user_id, funnel_id)
     SELECT $1, funnel_id FROM unnest($2::int[]) AS requested(funnel_id)`,
    [userId, funnelIds],
  );
  return funnelIds;
};

export const getActiveSalesManagerForFunnelTransfer = async (
  managerId: number,
  executor: QueryExecutor,
  fromManagerId?: number,
) => {
  const result = await executor.query<{ id: number; full_name: string }>(
    `SELECT u.id, u.full_name FROM users u
     WHERE u.id = $1 AND u.is_active = true AND u.is_archived = false
       AND (u.module = 'sales' OR EXISTS (
         SELECT 1 FROM user_modules access WHERE access.user_id = u.id AND access.module = 'sales'
       ))
       AND ($2::int IS NULL OR NOT EXISTS (
         SELECT 1 FROM academy_leads lead
         JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
         WHERE lead.manager_id = $2 AND NOT (
           EXISTS (SELECT 1 FROM academy_sales_funnel_users assignment
             WHERE assignment.user_id = u.id AND assignment.funnel_id = lead.funnel_id)
           AND (funnel.workflow_role IS NULL
             OR (funnel.workflow_role = 'closer' AND academy_kpi_employee_role(u.id) IN ('closer', 'full_cycle', 'full_cycle_3500'))
             OR (funnel.workflow_role = 'hunter' AND academy_kpi_employee_role(u.id) IS DISTINCT FROM 'closer'))
         )
       ))
     FOR UPDATE OF u`,
    [managerId, fromManagerId ?? null],
  );
  return result.rows[0] ?? null;
};
