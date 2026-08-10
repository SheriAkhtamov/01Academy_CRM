import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deriveMetaUtm,
  extractMetaAdHook,
  extractMetaPublication,
  extractMetaReferral,
  extractMetaThumbnail,
  buildMetaUserData,
  buildMetaCrmCustomData,
  extractMetaUtm,
  hashMetaPhone,
  mapMetaAdToCatalogRow,
  metaRetryDelayMinutes,
} from '../server/services/meta-marketing';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Meta marketing attribution', () => {
  it('reads only the bracketed hook convention from ad and creative names', () => {
    expect(extractMetaAdHook('UZ · Reels · [РЕБЁНОК СОЗДАЁТ ИГРУ] · August')).toBe('РЕБЁНОК СОЗДАЁТ ИГРУ');
    expect(extractMetaAdHook('Ad without a hook', 'Creative [ФОТО ДО И ПОСЛЕ]')).toBe('ФОТО ДО И ПОСЛЕ');
    expect(extractMetaAdHook('Ad without brackets')).toBeNull();
  });

  it('captures declared UTM values from URLs and raw url_tags', () => {
    expect(extractMetaUtm(
      'https://01academy.uz/?utm_source=instagram&utm_campaign=summer',
      'utm_medium=paid_social&utm_content={{ad.name}}',
    )).toEqual({
      utm_source: 'instagram',
      utm_campaign: 'summer',
      utm_medium: 'paid_social',
      utm_content: '{{ad.name}}',
    });
  });

  it('fills missing automatic UTM values without overwriting declared tags', () => {
    expect(deriveMetaUtm({
      current: { utm_source: 'declared-source' },
      channel: 'instagram',
      campaignName: 'Kids August',
      adName: '[HOOK] Reel 1',
      hookName: 'HOOK',
    })).toEqual({
      utm: {
        utm_source: 'declared-source',
        utm_medium: 'paid_social',
        utm_campaign: 'Kids August',
        utm_content: '[HOOK] Reel 1',
      },
      derived: true,
    });
  });

  it('reads Click-to-Instagram ad referrals from standalone and message events', () => {
    const standalone = extractMetaReferral({
      referral: {
        source: 'ADS',
        type: 'OPEN_THREAD',
        ad_id: '120000000001',
        source_url: 'https://ig.me/example?utm_source=instagram&utm_content=reel-1',
      },
    });
    expect(standalone).toMatchObject({
      adId: '120000000001',
      source: 'ADS',
      type: 'OPEN_THREAD',
      utm: { utm_source: 'instagram', utm_content: 'reel-1' },
    });

    expect(extractMetaReferral({
      message: { referral: { source_type: 'ad', source_id: '120000000002' } },
    })?.adId).toBe('120000000002');
    expect(extractMetaReferral({ referral: { source: 'SHORTLINK', ref: 'organic' } })).toBeNull();
  });

  it('resolves the exact Instagram or Facebook publication behind an ad creative', () => {
    expect(extractMetaPublication({
      effective_instagram_media_id: '18000000000001',
      instagram_permalink_url: 'https://www.instagram.com/reel/ABC123/',
    })).toEqual({
      id: '18000000000001',
      url: 'https://www.instagram.com/reel/ABC123/',
    });
    expect(extractMetaPublication({ effective_object_story_id: '1171222076066744_987654321' })).toEqual({
      id: '1171222076066744_987654321',
      url: 'https://www.facebook.com/1171222076066744/posts/987654321',
    });
    expect(extractMetaPublication({ instagram_permalink_url: 'https://example.com/not-meta' })).toEqual({
      id: null,
      url: null,
    });
  });

  it('picks a creative thumbnail from any ad shape but only from Meta hosts over https', () => {
    expect(extractMetaThumbnail({
      thumbnail_url: 'https://scontent.xx.fbcdn.net/v/t45/preview.jpg',
    })).toBe('https://scontent.xx.fbcdn.net/v/t45/preview.jpg');

    expect(extractMetaThumbnail({
      object_story_spec: { video_data: { image_url: 'https://scontent.cdninstagram.com/v/reel.jpg' } },
    })).toBe('https://scontent.cdninstagram.com/v/reel.jpg');

    expect(extractMetaThumbnail({
      asset_feed_spec: { images: [{ url: 'https://external.fbcdn.net/asset.png' }] },
    })).toBe('https://external.fbcdn.net/asset.png');

    // A look-alike host must not slip an arbitrary image into the CRM table.
    expect(extractMetaThumbnail({ thumbnail_url: 'https://evil-fbcdn.net/tracker.gif' })).toBeNull();
    expect(extractMetaThumbnail({ thumbnail_url: 'http://scontent.xx.fbcdn.net/insecure.jpg' })).toBeNull();
    expect(extractMetaThumbnail({})).toBeNull();
  });

  it('uses bounded exponential retry windows', () => {
    expect(metaRetryDelayMinutes(1)).toBe(1);
    expect(metaRetryDelayMinutes(4)).toBe(15);
    expect(metaRetryDelayMinutes(99)).toBe(720);
  });
});

describe('Meta ad catalog', () => {
  it('maps an ad into a catalog row with the hook, format and publication resolved', () => {
    expect(mapMetaAdToCatalogRow({
      id: '120200000000000001',
      name: '[МАМА ВЫБИРАЕТ ШКОЛУ] reels 15s',
      effective_status: 'ACTIVE',
      created_time: '2026-07-07T10:00:00+0000',
      campaign: { id: '23800000000000001', name: 'Мирсултан ИИ персонаж июль' },
      adset: { id: '23800000000000002', name: 'UZ 25-45' },
      creative: {
        id: '23800000000000003',
        object_type: 'VIDEO',
        thumbnail_url: 'https://scontent.xx.fbcdn.net/v/preview.jpg',
        instagram_permalink_url: 'https://www.instagram.com/reel/ABC123/',
      },
    })).toMatchObject({
      adId: '120200000000000001',
      campaignName: 'Мирсултан ИИ персонаж июль',
      adsetName: 'UZ 25-45',
      hookName: 'МАМА ВЫБИРАЕТ ШКОЛУ',
      mediaType: 'video',
      thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/preview.jpg',
      sourceUrl: 'https://www.instagram.com/reel/ABC123/',
      effectiveStatus: 'ACTIVE',
    });
  });

  it('keeps a default-named ad usable instead of dropping it', () => {
    const row = mapMetaAdToCatalogRow({
      id: '120200000000000009',
      name: 'Новое объявление с целью "Лиды"',
      creative: { object_type: 'IMAGE' },
    });
    expect(row.adId).toBe('120200000000000009');
    expect(row.adName).toBe('Новое объявление с целью "Лиды"');
    expect(row.hookName).toBeNull();
    expect(row.mediaType).toBe('image');
  });

  it('keeps ads without leads in the attribution report', () => {
    const analytics = read('../server/modules/academy/meta-marketing-analytics.ts');
    // The catalog drives the row list; attribution numbers are joined onto it.
    expect(analytics).toContain('SELECT ad_id AS attribution_key FROM meta_ads');
    expect(analytics).toContain('LEFT JOIN meta_ads catalog ON catalog.ad_id = keys.attribution_key');
    expect(analytics).toContain('COALESCE(stats.leads, 0)::int AS leads');
  });

  it('counts every Meta submission without duplicating CRM conversions', () => {
    const analytics = read('../server/modules/academy/meta-marketing-analytics.ts');
    expect(analytics).toContain('COUNT(*)::int AS leads');
    expect(analytics).toContain('ROW_NUMBER() OVER (');
    expect(analytics).toContain('WHERE lead_rank = 1');
    expect(analytics).toContain('SUM(revenue) FILTER (WHERE lead_rank = 1)');
    expect(analytics).not.toContain('SELECT DISTINCT ON (attribution.lead_id) attribution.*');
  });

  it('returns every attributed submission in the lead drill-down', () => {
    const analytics = read('../server/modules/academy/meta-marketing-analytics.ts');
    expect(analytics).toContain('SELECT attribution.id AS attribution_id');
    const client = read('../client/src/components/marketing/MetaAttributionSection.tsx');
    expect(client).toContain('key={lead.attributionId}');
    expect(client).toContain("spendMoney(selectedLeadsCreative.costPerLead)");
    expect(client).toContain('flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col');
    expect(client).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain');
  });

  it('joins ad spend onto the report and keeps spend-without-leads visible', () => {
    const analytics = read('../server/modules/academy/meta-marketing-analytics.ts');
    expect(analytics).toContain('FROM meta_ad_insights');
    expect(analytics).toContain('stat_date >= $3::date AND stat_date <= $4::date');
    expect(analytics).toContain('reportingRange.from, reportingRange.to');
    expect(analytics).not.toContain('stat_date >= $1::date AND stat_date < $2::date');
    // An ad that only spent — no leads, gone from the catalog — must still get a row.
    expect(analytics).toContain('SELECT ad_id FROM spend');
    expect(analytics).toContain('LEFT JOIN spend ON spend.ad_id = keys.attribution_key');
    expect(analytics).toContain('costPerLead: leads > 0');
    const scheduler = read('../server/services/scheduler.ts');
    expect(scheduler).toContain('cron.schedule("*/15 * * * *"');
    expect(scheduler).toContain('syncMetaAdInsights(3)');
  });

  it('shows a meaningful Meta creative name before the technical ad name', () => {
    const component = read('../client/src/components/marketing/MetaAttributionSection.tsx');
    expect(component).toContain('const creativeDisplayTitle');
    expect(component).toContain('|| row.adsetName');
    expect(component).toContain('{row.adName || row.creativeName');
  });

  it('ships a production-safe Meta spend resync command', () => {
    const script = read('../scripts/sync-meta-marketing.ts');
    const workflow = read('../.github/workflows/sync-meta-marketing.yml');
    expect(script).toContain('syncMetaAdInsights(days)');
    expect(script).toContain('FROM meta_ad_insights');
    expect(workflow).toContain('node dist/scripts/sync-meta-marketing.js --apply --days "$1"');
  });

  it('leaves spend in the account currency until a rate is configured', () => {
    const service = read('../server/services/meta-marketing.ts');
    expect(service).toContain('usdToUzsRate');
    // A missing or zero rate must not be treated as a valid conversion factor.
    expect(service).toContain('convertsToUzs: Number.isFinite(rate) && rate > 0');
  });

  it('ships the insights migration', () => {
    const migration = read('../migrations/0081_add_meta_ad_insights.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "meta_ad_insights"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_insights_ad_date_unique"');
  });

  it('ships the catalog migration', () => {
    const migration = read('../migrations/0080_add_meta_ad_catalog.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "meta_ads"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "meta_ads_ad_id_unique"');
  });
});

describe('Meta CRM stage events', () => {
  it('marks every stage event as a Conversion Leads CRM event', () => {
    expect(buildMetaCrmCustomData('01Academy CRM', { crm_stage: 'qualified' })).toEqual({
      crm_stage: 'qualified',
      event_source: 'crm',
      lead_event_source: '01Academy CRM',
    });
    expect(buildMetaCrmCustomData('  ', { event_source: 'website' })).toEqual({
      event_source: 'crm',
      lead_event_source: '01Academy_CRM',
    });
  });

  it('recovers accurate recent stage history for Meta validation', () => {
    const service = read('../server/services/meta-marketing.ts');
    expect(service).toContain('FROM academy_lead_stage_history history');
    expect(service).toContain("history.entered_at >= NOW() - INTERVAL '7 days'");
    expect(service).toContain("inner_attribution.leadgen_id ~ '^[0-9]{15,16}$'");
    expect(service).toContain("'crm-history:' || eligible.history_id");
    expect(service).toContain("'event_source', 'crm'");
    expect(service).toContain("'lead_event_source', $1::text");
  });

  it('hashes only real phone numbers, never the Instagram placeholder', () => {
    // sha256 of "998901234567"
    expect(hashMetaPhone('+998 90 123-45-67')).toBe(hashMetaPhone('998901234567'));
    expect(hashMetaPhone('+998901234567')).toMatch(/^[a-f0-9]{64}$/);
    // The CRM stores `instagram:<id>` in the phone column for DM leads.
    expect(hashMetaPhone('instagram:17841400000000')).toBeNull();
    expect(hashMetaPhone('12345')).toBeNull();
    expect(hashMetaPhone(null)).toBeNull();
  });

  it('sends an event for every stage change, not just one configured stage', () => {
    const service = read('../server/services/meta-marketing.ts');
    expect(service).toContain('if (!statusCode || previousStatus === statusCode) return null;');
    // The event name comes from the CRM stage, so the pipeline drives what Meta offers.
    expect(service).toContain('status.name AS stage_name');
    expect(service).toContain('const eventName = cleanText(row.stage_name, 60) ?? statusCode;');
    expect(service).not.toContain('conversionStageCode');
  });

  it('sends every identifier the CRM holds so Meta can actually match the person', () => {
    const userData = buildMetaUserData({
      leadgen_id: '9988776655',
      phone: '+998 90 123-45-67',
      contact_name: 'Дилноза Каримова',
    });
    expect(userData.lead_id).toBe('9988776655');
    expect(userData.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(userData.fn[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(userData.ln[0]).toMatch(/^[a-f0-9]{64}$/);
    // Names are hashed case- and punctuation-insensitively, per Meta's normalisation.
    expect(buildMetaUserData({ contact_name: '  ДИЛНОЗА  ' }).fn)
      .toEqual(buildMetaUserData({ contact_name: 'Дилноза' }).fn);
    // The Instagram placeholder is not a phone and must not be hashed as one.
    expect(buildMetaUserData({ phone: 'instagram:17841400000000' }).ph).toBeUndefined();
  });

  it('reports real money when there is any, and never invents a zero', () => {
    const service = read('../server/services/meta-marketing.ts');
    expect(service).toContain('paidAmount > 0 ? paidAmount : (stageValue > 0 ? stageValue : null)');
    // A stage with no agreed value sends no value at all rather than value 0, which
    // would teach Meta the stage is worthless.
    expect(service).toContain("...(conversionValue !== null ? { value: conversionValue, currency: 'UZS' } : {})");
  });

  it('uses only a real lead form id for Conversion Leads CRM events', () => {
    const service = read('../server/services/meta-marketing.ts');
    // Meta rejects custom event names on action_source business_messaging (subcode
    // 2804066), so stage-named events must never be routed through the conversation id.
    expect(service).not.toContain("matchKey: 'ig_sid'");
    expect(service).not.toContain("actionSource: 'business_messaging'");
    expect(service).toContain("actionSource: 'system_generated',");
    expect(service).toContain('if (!userData.lead_id) return null;');
    expect(service).toContain("matchKey: 'leadgen_id'");
    expect(service).toContain('userData: { lead_id: userData.lead_id }');
  });

  it('omits the messaging channel for events that had no conversation', () => {
    const service = read('../server/services/meta-marketing.ts');
    expect(service).toContain('...(event.messaging_channel ? { messaging_channel: event.messaging_channel } : {})');
  });

  it('surfaces the actionable half of a Meta error, not just "Invalid parameter"', () => {
    const service = read('../server/services/meta-marketing.ts');
    expect(service).toContain('cleanText(error.error_user_msg, 900)');
  });

  it('serves the live stage list to the integrations page', () => {
    const operations = read('../server/modules/academy/operations.router.ts');
    expect(operations).toContain('SELECT code, name FROM academy_lead_statuses ORDER BY sort_order, code');
    expect(operations).toContain('conversionStages');
  });
});

describe('Meta integration wiring', () => {
  it('supports an idempotent one-off import for exact Meta Lead IDs', () => {
    const service = read('../server/services/meta-lead-ads.ts');
    const script = read('../scripts/import-meta-lead-ads.ts');
    const workflow = read('../.github/workflows/import-meta-leads.yml');
    expect(service).toContain('export const importMetaLeadAdsByIds');
    expect(service).toContain('export const syncRecentMetaLeadAds');
    expect(service).toContain("field: 'time_created'");
    expect(service).toContain("provider: 'meta_lead_ads_live'");
    expect(script).toContain("process.argv.indexOf('--ids')");
    expect(workflow).toContain('Import Meta leads by ID');
    expect(workflow).toContain('node dist/scripts/import-meta-lead-ads.js --apply --ids "$1"');
  });

  it('subscribes Instagram accounts to referral webhooks', () => {
    expect(read('../server/services/instagram.ts')).toContain("'messaging_referrals'");
  });

  it('queues stage events only after the lead transaction commits', () => {
    const leadEffects = read('../server/modules/academy/academy-leads.ts');
    expect(leadEffects).toContain('runAfterTransactionCommit(async () =>');
    expect(leadEffects.indexOf('runAfterTransactionCommit(async () =>'))
      .toBeLessThan(leadEffects.indexOf('enqueueMetaConversionForLead(lead, previousStatus)'));
  });

  it('ships the migration and safe configuration template', () => {
    const migration = read('../migrations/0075_add_meta_attribution_and_capi.sql');
    const exampleConfig = read('../config/app.config.example.json');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "meta_lead_attributions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "meta_conversion_events"');
    expect(exampleConfig).not.toContain('conversionStageCode');
    expect(exampleConfig).toContain('"marketingAccessToken": ""');
    expect(exampleConfig).toContain('"capiAccessToken": ""');
  });
});
