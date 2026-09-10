import type { Pool, PoolClient } from 'pg';
export {
  FIXED_LEAD_INTEGRATION_PROVIDERS as LEAD_INTEGRATION_PROVIDERS,
  isLeadIntegrationProvider,
  isWebsiteLeadIntegrationProvider,
  websiteIntegrationDomain,
  websiteIntegrationProvider,
  type LeadIntegrationProvider,
} from '@shared/lead-integrations';
import type { LeadIntegrationProvider } from '@shared/lead-integrations';

type QueryExecutor = Pick<Pool | PoolClient, 'query'>;

export const resolveLeadFunnelId = async (
  executor: QueryExecutor,
  provider?: LeadIntegrationProvider,
): Promise<number> => {
  if (provider) {
    const configured = await executor.query<{ id: number }>(
      `SELECT funnel.id
       FROM academy_integration_funnel_settings setting
       JOIN academy_sales_funnels funnel ON funnel.id = setting.funnel_id
       WHERE setting.provider = $1
         AND funnel.is_active = true
       LIMIT 1`,
      [provider],
    );
    const configuredId = Number(configured.rows[0]?.id);
    if (Number.isSafeInteger(configuredId) && configuredId > 0) return configuredId;
  }

  const fallback = await executor.query<{ id: number }>(
    `SELECT id
     FROM academy_sales_funnels
     WHERE is_active = true
     ORDER BY is_default DESC, id
     LIMIT 1`,
  );
  const fallbackId = Number(fallback.rows[0]?.id);
  if (!Number.isSafeInteger(fallbackId) || fallbackId <= 0) {
    throw Object.assign(new Error('salesFunnelRequired'), { statusCode: 409 });
  }
  return fallbackId;
};
