import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deriveMetaUtm,
  extractMetaAdHook,
  extractMetaPublication,
  extractMetaReferral,
  extractMetaThumbnail,
  extractMetaUtm,
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

  it('ships the catalog migration', () => {
    const migration = read('../migrations/0080_add_meta_ad_catalog.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "meta_ads"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "meta_ads_ad_id_unique"');
  });
});

describe('Meta integration wiring', () => {
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
    expect(exampleConfig).toContain('"conversionStageCode": "demo_invited"');
    expect(exampleConfig).toContain('"conversionEventName": "LeadSubmitted"');
    expect(exampleConfig).toContain('"marketingAccessToken": ""');
    expect(exampleConfig).toContain('"capiAccessToken": ""');
  });
});
