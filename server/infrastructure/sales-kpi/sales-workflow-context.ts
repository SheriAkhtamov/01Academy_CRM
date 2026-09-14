import { pool } from '../../db';
import type { ActorContext } from '../../modules/leads/domain/actor-context';

export async function attachSalesWorkflow(actor: ActorContext): Promise<ActorContext> {
  if (actor.salesWorkflow || !actor.modules.includes('sales') || actor.isLeadership) return actor;
  const { rows: [workflow] } = await pool.query(
    `SELECT academy_kpi_employee_role($1) AS role,
      (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'hunter') AS "hunterFunnelId",
      (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'closer') AS "closerFunnelId",
      (SELECT id FROM academy_sales_funnels WHERE is_default = true) AS "defaultFunnelId",
      COALESCE((
        SELECT auto_lead_distribution_enabled
        FROM academy_company_settings
        ORDER BY id
        LIMIT 1
      ), false) AS "autoLeadDistributionEnabled",
      COALESCE((
        SELECT array_agg(funnel_id ORDER BY funnel_id)
        FROM academy_sales_funnel_users
        WHERE user_id = $1
      ), '{}'::int[]) AS "assignedFunnelIds"`, [actor.userId],
  );
  return { ...actor, salesWorkflow: workflow };
}
