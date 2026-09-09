import type { Pool, PoolClient } from 'pg';

export const LEAD_INTEGRATION_PROVIDERS = [
  'website',
  'instagram',
  'meta',
  'onlinepbx',
] as const;

export type LeadIntegrationProvider = typeof LEAD_INTEGRATION_PROVIDERS[number];

type QueryExecutor = Pick<Pool | PoolClient, 'query'>;

export const isLeadIntegrationProvider = (value: unknown): value is LeadIntegrationProvider => (
  LEAD_INTEGRATION_PROVIDERS.includes(String(value) as LeadIntegrationProvider)
);

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
