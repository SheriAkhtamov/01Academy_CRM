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

    await expect(resolveLeadFunnelId({ query } as any, 'website:01academy.uz')).resolves.toBe(4);
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
    expect(isLeadIntegrationProvider('website:01academy.uz')).toBe(true);
    expect(isLeadIntegrationProvider('website:01academy.pro')).toBe(true);
    expect(isLeadIntegrationProvider('website')).toBe(false);
    expect(isLeadIntegrationProvider('telegram_tasks')).toBe(false);
  });

  it('keeps domain-specific lead-source routing in Sales Management funnels', () => {
    const funnelsPanel = readFileSync(
      new URL('../client/src/features/sales-funnels/SalesFunnelsPanel.tsx', import.meta.url),
      'utf8',
    );
    const integrationsPage = readFileSync(
      new URL('../client/src/pages/academy.tsx', import.meta.url),
      'utf8',
    );

    expect(funnelsPanel).toContain('<Dialog open={dialogOpen}');
    expect(funnelsPanel).toContain('leadSourceProviders.map');
    expect(funnelsPanel).toContain('websiteIntegrationDomain(provider)');
    expect(funnelsPanel).toContain('sales-funnel-source-${provider}');
    expect(funnelsPanel).toContain("t('funnelIntegrations')");
    expect(funnelsPanel).not.toContain("t('leadSourceDistributionDescription')");
    expect(funnelsPanel).not.toContain('salesFunnelsApi.assignIntegration');
    expect(funnelsPanel).not.toContain('lead-source-funnel-${provider}');
    expect(integrationsPage).not.toContain('salesFunnelsApi.assignIntegration');
    expect(integrationsPage).not.toContain('integration-funnel-');
  });

  it('places sales funnels in Sales Management and preserves the former link', () => {
    const settingsPage = readFileSync(
      new URL('../client/src/pages/academy-settings.tsx', import.meta.url),
      'utf8',
    );

    expect(settingsPage).toContain(
      "const academyConfigurationTabs = ['schools', 'rooms', 'courses', 'groups'];",
    );
    expect(settingsPage).toContain(
      "const salesSettingsTabs = ['lead-assignment', 'pipeline', 'funnels', 'lead-merge', 'kpi'];",
    );
    expect(settingsPage).toContain("navigate('/admin/sales-settings?tab=funnels', { replace: true })");
  });

  it('accepts only a unique list of lead-producing sources in funnel forms', () => {
    expect(parseFunnelIntegrations(undefined)).toBeUndefined();
    expect(parseFunnelIntegrations([
      'website:01academy.uz',
      'website:01academy.uz',
      'website:01academy.pro',
      'meta',
    ])).toEqual(['website:01academy.uz', 'website:01academy.pro', 'meta']);
    expect(() => parseFunnelIntegrations(['website'])).toThrow('invalidData');
    expect(() => parseFunnelIntegrations(['telegram_tasks'])).toThrow('invalidData');
    expect(() => parseFunnelIntegrations('website')).toThrow('invalidData');
  });
});

describe('0106 website integration split migration', () => {
  const migration = readFileSync(
    new URL('../migrations/0106_split_website_integrations.sql', import.meta.url),
    'utf8',
  ).replace(/\s+/g, ' ');

  it('creates separate routing settings and lead sources for both sites', () => {
    expect(migration).toContain("('website:01academy.uz')");
    expect(migration).toContain("('website:01academy.pro')");
    expect(migration).toContain("('website:01academy.uz', '01academy.uz', 'website'");
    expect(migration).toContain("('website:01academy.pro', '01academy.pro', 'website'");
    expect(migration).toContain('DELETE FROM "academy_integration_funnel_settings" WHERE "provider" = \'website\'');
  });

  it('reclassifies identifiable historical leads and integration events', () => {
    expect(migration).toContain('WITH website_events AS');
    expect(migration).toContain('UPDATE "academy_leads" lead');
    expect(migration).toContain('UPDATE "academy_integration_logs" log');
    expect(migration).toContain("SET \"provider\" = 'website:' || classified.site_domain");
  });

  it('is registered immediately after the sales funnel migration', () => {
    const journal = JSON.parse(readFileSync(
      new URL('../migrations/meta/_journal.json', import.meta.url),
      'utf8',
    )) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.find((entry) => entry.idx === 105)?.tag).toBe('0105_add_sales_funnels');
    expect(journal.entries.find((entry) => entry.idx === 106)?.tag).toBe('0106_split_website_integrations');
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
