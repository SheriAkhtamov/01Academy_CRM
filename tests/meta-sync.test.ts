import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  meta: {
    adAccountId: '11111', adAccountIds: ['act_22222', '11111'], marketingAccessToken: 'fixture-marketing',
    leadAccessToken: 'fixture-leads', pageId: 'page-1', marketingPageId: 'page-1', apiVersion: 'v25.0',
  },
  graph: vi.fn(), query: vi.fn(), import: vi.fn(), error: vi.fn(), info: vi.fn(),
}));
vi.mock('../server/config', () => ({ appConfig: { integrations: { metaAds: mocks.meta }, server: { appUrl: 'https://crm.example', environment: 'test' } } }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../server/lib/logger', () => ({ logger: { error: mocks.error, info: mocks.info, warn: vi.fn() } }));
vi.mock('../server/services/meta-graph', () => ({ fetchMetaGraphJson: mocks.graph }));
vi.mock('../server/services/lead-import', () => ({ importLeadRecords: mocks.import, buildLeadImportComment: vi.fn() }));

import { getMetaMarketingIntegrationConfig, syncMetaAdCatalog, syncMetaAdInsights } from '../server/services/meta-marketing';
import { syncRecentMetaLeadAds } from '../server/services/meta-lead-ads';

const summary = { created: 1, merged: 0, mergedArchived: 0, skippedTest: 0, skippedInvalid: 0, alreadyImported: 0 };

describe('multiple Meta ad accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.graph.mockReset();
    mocks.import.mockReset().mockResolvedValue(summary);
    Object.assign(mocks.meta, { adAccountId: '11111', adAccountIds: ['act_22222', '11111'], marketingPageId: 'page-1' });
  });

  it('keeps the original account, normalizes act prefixes and removes duplicates', () => {
    expect(getMetaMarketingIntegrationConfig()).toMatchObject({ adAccountId: '11111', adAccountIds: ['11111', '22222'] });
  });

  it('syncs both account catalogs while excluding other brands in a shared account', async () => {
    mocks.graph.mockImplementation(async (url: URL) => ({ data: [
      { id: `own-${url.pathname}`, creative: { effective_object_story_id: 'page-1_story' } },
      { id: 'other-brand', creative: { object_story_spec: { page_id: 'other-page' } } },
    ] }));
    await expect(syncMetaAdCatalog()).resolves.toEqual({ synced: 2, skipped: false, failedAccounts: [] });
    expect(mocks.graph.mock.calls.map(([url]) => url.pathname)).toEqual(['/v25.0/act_11111/ads', '/v25.0/act_22222/ads']);
    const writes = mocks.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO meta_ads'));
    expect(writes).toHaveLength(2);
    expect(writes.every(([, params]) => params[0] !== 'other-brand')).toBe(true);
    expect(JSON.parse(writes[1][1][16]).account_id).toBe('22222');
  });

  it('continues the second account when access to the first fails', async () => {
    const failure = new Error('Account access revoked');
    mocks.graph.mockRejectedValueOnce(failure).mockResolvedValueOnce({ data: [
      { id: 'second-account-ad', creative: { object_story_spec: { page_id: 'page-1' } } },
    ] });
    await expect(syncMetaAdCatalog()).resolves.toEqual({ synced: 1, skipped: false, failedAccounts: ['11111'] });
    expect(mocks.error).toHaveBeenCalledWith('Meta account sync failed', { operation: 'catalog', adAccountId: '11111', error: failure });
    expect(mocks.graph).toHaveBeenCalledTimes(2);
  });

  it('only imports spend for the selected Page from each account', async () => {
    mocks.query.mockImplementation(async (sql: string, params: string[]) => sql.startsWith('SELECT ad_id')
      ? { rows: [{ ad_id: `own-${params[0]}` }] } : { rows: [] });
    mocks.graph.mockImplementation(async (url: URL) => ({ data: [
      { ad_id: url.pathname.includes('11111') ? 'own-11111' : 'own-22222', date_start: '2026-10-20', spend: '10', account_currency: 'USD' },
      { ad_id: 'other-brand-ad', date_start: '2026-10-20', spend: '999', account_currency: 'USD' },
    ] }));
    await expect(syncMetaAdInsights(3)).resolves.toEqual({ synced: 2, skipped: false, failedAccounts: [] });
    const writes = mocks.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO meta_ad_insights'));
    expect(writes.map(([, params]) => params[0])).toEqual(['own-11111', 'own-22222']);
  });

  it('retains legacy single-account configuration without a Page restriction', async () => {
    mocks.meta.adAccountIds = [];
    mocks.meta.marketingPageId = '';
    mocks.graph.mockResolvedValue({ data: [{ id: 'legacy-ad' }] });
    await expect(syncMetaAdCatalog()).resolves.toMatchObject({ synced: 1 });
    expect(mocks.graph).toHaveBeenCalledOnce();
  });

  it('checks remaining lead forms after a form fails and logs its identity and reason', async () => {
    const failure = new Error('Lead access revoked for this form');
    mocks.graph.mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith('/leadgen_forms')) return { data: [{ id: 'form-bad', name: 'Broken' }, { id: 'form-ok', name: 'Working' }] };
      if (url.pathname.includes('form-bad')) throw failure;
      return { data: [{ id: 'lead-1', platform: 'fb', field_data: [{ name: 'full_name', values: ['Fixture'] }] }] };
    });
    await expect(syncRecentMetaLeadAds()).resolves.toMatchObject({ skipped: false, forms: 1, failedForms: 1, records: 1, summary });
    expect(mocks.import).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ externalId: 'lead-1', platform: 'fb' })], expect.objectContaining({ provider: 'meta_lead_ads_live' }));
    expect(mocks.error).toHaveBeenCalledWith('Meta Lead Ads form sync failed', {
      pageId: 'page-1', formId: 'form-bad', formName: 'Broken', error: failure,
    });
  });
});
