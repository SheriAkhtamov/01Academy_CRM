import { pool } from '../../db';
import type { ActorContext } from '../../modules/leads/domain/actor-context';

export async function attachSalesWorkflow(actor: ActorContext): Promise<ActorContext> {
  if (actor.salesWorkflow || !actor.modules.includes('sales') || actor.isLeadership) return actor;
  const { rows: [workflow] } = await pool.query(
    `SELECT academy_kpi_employee_role($1) AS role,
      (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'hunter') AS "hunterFunnelId",
      (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'closer') AS "closerFunnelId"`, [actor.userId],
  );
  return { ...actor, salesWorkflow: workflow };
}
