import { queryOne } from './academy-core';

export const assertSalesFunnelAssignment = async (funnelId: unknown, managerId: number) => {
  if (!funnelId) return;
  const result = await queryOne<{
    isAssigned: boolean;
  }>(
    `SELECT EXISTS (
              SELECT 1 FROM academy_sales_funnel_users
              WHERE user_id = $2 AND funnel_id = $1
            ) AS is_assigned
     FROM academy_sales_funnels WHERE id = $1`, [Number(funnelId), managerId],
  );
  if (!result?.isAssigned) {
    throw Object.assign(new Error('salesFunnelNotAssigned'), { statusCode: 403 });
  }
};

export const assertSalesFunnelStage = async (funnelId: unknown, statusCode: string) => {
  const stage = await queryOne<{ funnelId: number }>(
    `SELECT funnel_id FROM academy_lead_statuses
     WHERE code = $1 AND is_active = true AND is_pipeline = true`, [statusCode],
  );
  if (!funnelId || !stage || Number(stage.funnelId) !== Number(funnelId)) {
    throw Object.assign(new Error('salesFunnelStageUnavailable'), { statusCode: 409 });
  }
};
