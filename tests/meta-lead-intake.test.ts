import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../server/config', () => ({ isProductionEnvironment: false, appConfig: { integrations: { metaAds: { capiAccessToken: 'test-only', datasetId: 'test', partnerAgent: 'Test CRM' } } } }));
import { enqueueMetaLeadIntake, enqueueRecentMetaLeadIntakes, retryMetaConversionEvent } from '../server/services/meta-marketing';
const createdAt = new Date('2026-10-07T08:00:00.000Z');
const identity = { attribution_id: 99, leadgen_id: '123456789012345', ad_id: '17', campaign_id: '9', hook_name: null,
  phone: '+998901234567', contact_name: 'Parent', created_at: createdAt };
describe('Meta intake creation facts', () => {
  beforeEach(() => vi.clearAllMocks());
  it('emits one stable Lead event at the actual creation time without a stage or stage value', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [identity] }).mockResolvedValueOnce({ rows: [{ id: 21 }] });
    await expect(enqueueMetaLeadIntake(42)).resolves.toEqual({ id: 21 });
    const [sql, values] = mocks.query.mock.calls[1];
    expect(sql).toContain("$3,'Lead',NULL,$4");
    expect(sql).toContain('ON CONFLICT (event_id) DO NOTHING');
    expect(values[2]).toBe('lead-intake:42');
    expect(mocks.query.mock.calls[0][0]).toContain("delivered.status = 'sent' AND initial.from_status_code IS NULL");
    expect(mocks.query.mock.calls[0][0]).toContain("delivered.event_id = 'crm:' || lead.id || ':' || initial.to_status_code");
    expect(values[3]).toBe(createdAt);
    expect(JSON.parse(values[8])).toEqual({ event_source: 'crm', lead_event_source: 'Test CRM', source_ad_id: '17', source_campaign_id: '9' });
    expect(JSON.parse(values[8])).not.toHaveProperty('crm_stage');
    expect(JSON.parse(values[8])).not.toHaveProperty('value');
  });
  it('does not invent attribution when the lead has no matching Meta identity', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(enqueueMetaLeadIntake(42)).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it('recovers real recent creations without reading stage history or current-stage thresholds', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 42 }] }).mockResolvedValueOnce({ rows: [identity] })
      .mockResolvedValueOnce({ rows: [{ id: 21 }] });
    await expect(enqueueRecentMetaLeadIntakes()).resolves.toBe(1);
    expect(mocks.query.mock.calls[0][0]).toContain('lead.created_at');
    expect(mocks.query.mock.calls[0][0]).not.toMatch(/sort_order|status_code\s*(?:=|>=|<=)\s*'/);
    expect(mocks.query.mock.calls[0][0]).toContain('initial.from_status_code IS NULL');
  });
  it('never retries cancelled historical stage events', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(retryMetaConversionEvent(21)).resolves.toBeNull();
    expect(mocks.query.mock.calls[0][0]).toContain("status IN ('pending', 'failed') AND crm_stage IS NULL");
  });
});
