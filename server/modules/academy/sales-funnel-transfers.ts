import type { SalesFunnelTransferOption } from '@shared/contracts/sales-funnels';
import { query } from './academy-core';

/** Transfer destinations expose no lead records, counts or employee data. */
export const listSalesFunnelTransferOptions = (): Promise<SalesFunnelTransferOption[]> => query(
  `SELECT funnel.id, funnel.name, funnel.initial_stage_code,
          COALESCE(jsonb_agg(jsonb_build_object('code', stage.code, 'name', stage.name)
            ORDER BY stage.sort_order, stage.id) FILTER (WHERE stage.id IS NOT NULL), '[]'::jsonb) AS stages
   FROM academy_sales_funnels funnel
   LEFT JOIN academy_lead_statuses stage
     ON stage.funnel_id = funnel.id AND stage.is_active = true AND stage.is_pipeline = true
   WHERE funnel.is_active = true
   GROUP BY funnel.id
   ORDER BY funnel.is_default DESC, funnel.created_at, funnel.id`,
);
