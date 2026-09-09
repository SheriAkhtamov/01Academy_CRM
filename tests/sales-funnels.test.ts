import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  isLeadIntegrationProvider,
  resolveLeadFunnelId,
} from '../server/services/lead-funnels';
import { parseFunnelIntegrations } from '../server/modules/academy/funnels.router';

describe('sales funnel lead routing', () => {
  it('uses the active funnel assigned to the integration', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 17 }] });

    await expect(resolveLeadFunnelId({ query } as any, 'instagram')).resolves.toBe(17);
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('setting.provider = $1'),
      ['instagram'],
    );
  });

  it('falls back to the active default funnel when an assignment is unavailable', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] });

    await expect(resolveLeadFunnelId({ query } as any, 'website')).resolves.toBe(4);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1][0])).toContain('ORDER BY is_default DESC');
  });

  it('fails closed when no active funnel can accept a lead', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(resolveLeadFunnelId({ query } as any, 'meta')).rejects.toMatchObject({
      message: 'salesFunnelRequired',
      statusCode: 409,
    });
  });

  it('accepts only integrations that generate CRM leads', () => {
    expect(isLeadIntegrationProvider('onlinepbx')).toBe(true);
    expect(isLeadIntegrationProvider('telegram_tasks')).toBe(false);
  });

  it('keeps lead-source routing in Academy Structure sales funnels', () => {
    const funnelsPanel = readFileSync(
      new URL('../client/src/features/sales-funnels/SalesFunnelsPanel.tsx', import.meta.url),
      'utf8',
    );
    const integrationsPage = readFileSync(
      new URL('../client/src/pages/academy.tsx', import.meta.url),
      'utf8',
    );

    expect(funnelsPanel).toContain('<Dialog open={dialogOpen}');
    expect(funnelsPanel).toContain('LEAD_SOURCE_PROVIDERS.map');
    expect(funnelsPanel).toContain('sales-funnel-source-${provider}');
    expect(funnelsPanel).toContain("t('leadSourceDistributionDescription')");
    expect(funnelsPanel).not.toContain('salesFunnelsApi.assignIntegration');
    expect(funnelsPanel).not.toContain('lead-source-funnel-${provider}');
    expect(integrationsPage).not.toContain('salesFunnelsApi.assignIntegration');
    expect(integrationsPage).not.toContain('integration-funnel-');
  });

  it('accepts only a unique list of lead-producing sources in funnel forms', () => {
    expect(parseFunnelIntegrations(undefined)).toBeUndefined();
    expect(parseFunnelIntegrations(['website', 'website', 'meta'])).toEqual(['website', 'meta']);
    expect(() => parseFunnelIntegrations(['telegram_tasks'])).toThrow('invalidData');
    expect(() => parseFunnelIntegrations('website')).toThrow('invalidData');
  });
});

describe('0105 sales funnel migration', () => {
  const migration = readFileSync(
    new URL('../migrations/0105_add_sales_funnels.sql', import.meta.url),
    'utf8',
  ).replace(/\s+/g, ' ');

  it('backfills every existing lead before enforcing its funnel', () => {
    expect(migration).toContain('ALTER TABLE "academy_leads" ADD COLUMN "funnel_id" integer');
    expect(migration).toContain('UPDATE "academy_leads" SET "funnel_id"');
    expect(migration).toContain('ALTER TABLE "academy_leads" ALTER COLUMN "funnel_id" SET NOT NULL');
    expect(migration.indexOf('UPDATE "academy_leads" SET "funnel_id"')).toBeLessThan(
      migration.indexOf('ALTER TABLE "academy_leads" ALTER COLUMN "funnel_id" SET NOT NULL'),
    );
  });

  it('seeds all lead-producing integrations into the default funnel', () => {
    for (const provider of ['website', 'instagram', 'meta', 'onlinepbx']) {
      expect(migration).toContain(`('${provider}')`);
    }
    expect(migration).toContain('ON DELETE restrict');
  });
});
