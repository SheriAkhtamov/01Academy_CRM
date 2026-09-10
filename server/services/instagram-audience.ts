import { pool } from '../db';
import { logger } from '../lib/logger';

const moduleAccessSql = (module: 'administration' | 'sales') => `(
  u.module = '${module}' OR EXISTS (
    SELECT 1 FROM user_modules access
    WHERE access.user_id = u.id AND access.module = '${module}'
  )
)`;

/** Resolves the fail-closed realtime audience for one Instagram conversation. */
export const getInstagramConversationAudienceUserIds = async (
  managerId?: number | null,
  funnelId?: number | null,
): Promise<number[]> => {
  const normalizedManagerId = Number(managerId) > 0 ? Number(managerId) : null;
  const normalizedFunnelId = Number(funnelId) > 0 ? Number(funnelId) : null;
  try {
    const params: unknown[] = normalizedManagerId
      ? [normalizedManagerId]
      : normalizedFunnelId ? [normalizedFunnelId] : [];
    const salesScope = normalizedManagerId
      ? `(u.id = $1 AND ${moduleAccessSql('sales')})`
      : normalizedFunnelId
        ? `(${moduleAccessSql('sales')} AND EXISTS (
          SELECT 1 FROM academy_sales_funnel_users assignment
          WHERE assignment.user_id = u.id AND assignment.funnel_id = $1
        ))`
        : moduleAccessSql('sales');
    const { rows } = await pool.query<{ id: number | string }>(
      `SELECT DISTINCT u.id FROM users u
       WHERE u.is_active = true AND (${moduleAccessSql('administration')} OR ${salesScope})
       ORDER BY u.id`,
      params,
    );
    return [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))];
  } catch (error) {
    logger.error('Failed to resolve Instagram realtime audience', {
      managerId: normalizedManagerId,
      funnelId: normalizedFunnelId,
      error,
    });
    return [];
  }
};
