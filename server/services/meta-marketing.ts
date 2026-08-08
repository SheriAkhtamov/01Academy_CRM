import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { appConfig } from '../config';
import { pool } from '../db';
import { logger } from '../lib/logger';

const META_FETCH_TIMEOUT_MS = 20_000;
const META_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const META_MAX_ATTEMPTS = 8;
const META_GRAPH_ORIGIN = 'https://graph.facebook.com';

type JsonObject = Record<string, any>;

type MetaAttributionRow = {
  id: number;
  ad_id: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  utm_values: Record<string, string> | null;
  channel: string;
  enrichment_attempts: number;
};

type MetaConversionRow = {
  id: number;
  event_id: string;
  event_name: string;
  event_time: Date | string;
  action_source: string;
  messaging_channel: string | null;
  user_data: JsonObject;
  custom_data: JsonObject;
  attempt_count: number;
};

export type MetaReferral = {
  adId: string | null;
  source: string | null;
  type: string | null;
  ref: string | null;
  sourceUrl: string | null;
  placement: string | null;
  utm: Record<string, string>;
  raw: JsonObject;
};

const cleanText = (value: unknown, maxLength = 500): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const cleanError = (value: unknown) => cleanText(
  value instanceof Error ? value.message : value,
  2_000,
) ?? 'Unknown Meta API error';

const isPlainObject = (value: unknown): value is JsonObject => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export const extractMetaAdHook = (...values: unknown[]): string | null => {
  const candidates = values.map((value) => cleanText(value)).filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const bracketed = candidate.match(/\[([^\[\]]{1,500})\]/u)?.[1]?.trim();
    if (bracketed) return bracketed.slice(0, 500);
  }
  return null;
};

const putUtmValue = (target: Record<string, string>, key: string, value: unknown) => {
  const normalizedKey = key.toLowerCase().trim();
  if (!/^utm_[a-z0-9_]{1,60}$/.test(normalizedKey)) return;
  const normalizedValue = cleanText(value);
  if (normalizedValue) target[normalizedKey] = normalizedValue;
};

const collectUtmFromSearchParams = (target: Record<string, string>, params: URLSearchParams) => {
  params.forEach((value, key) => putUtmValue(target, key, value));
};

const collectUtmFromValue = (target: Record<string, string>, value: unknown) => {
  const normalized = cleanText(value, 4_000);
  if (!normalized) return;
  try {
    const candidate = new URL(normalized);
    collectUtmFromSearchParams(target, candidate.searchParams);
    return;
  } catch {
    // Meta may return url_tags or ref as a raw query string instead of a URL.
  }
  const query = normalized.startsWith('?') ? normalized.slice(1) : normalized;
  if (query.includes('=')) collectUtmFromSearchParams(target, new URLSearchParams(query));
};

export const extractMetaUtm = (...values: unknown[]): Record<string, string> => {
  const result: Record<string, string> = {};
  values.forEach((value) => collectUtmFromValue(result, value));
  return result;
};

export const deriveMetaUtm = (values: {
  current?: Record<string, string> | null;
  channel?: string | null;
  campaignName?: string | null;
  adName?: string | null;
  hookName?: string | null;
}) => {
  const utm = { ...(values.current ?? {}) };
  let derived = false;
  const fill = (key: string, value: string | null | undefined) => {
    const normalized = cleanText(value);
    if (!utm[key] && normalized) {
      utm[key] = normalized;
      derived = true;
    }
  };
  fill('utm_source', values.channel || 'instagram');
  fill('utm_medium', 'paid_social');
  fill('utm_campaign', values.campaignName);
  fill('utm_content', values.adName || values.hookName);
  return { utm, derived };
};

export const extractMetaReferral = (event: unknown): MetaReferral | null => {
  if (!isPlainObject(event)) return null;
  const rawReferral = [event.referral, event.message?.referral, event.postback?.referral]
    .find(isPlainObject);
  if (!rawReferral) return null;

  const source = cleanText(rawReferral.source ?? rawReferral.source_type, 120);
  const type = cleanText(rawReferral.type ?? rawReferral.source_type, 120);
  const adId = cleanText(
    rawReferral.ad_id
      ?? (String(rawReferral.source_type ?? '').toLowerCase() === 'ad' ? rawReferral.source_id : null),
    120,
  );
  const ref = cleanText(rawReferral.ref, 4_000);
  const sourceUrl = cleanText(rawReferral.source_url ?? rawReferral.url, 4_000);
  const placement = cleanText(rawReferral.placement, 120);
  const utm = extractMetaUtm(sourceUrl, ref, rawReferral.url_tags);
  const isAd = Boolean(adId)
    || /^(ads?|advertisement)$/i.test(source ?? '')
    || /^(ads?|advertisement)$/i.test(type ?? '')
    || Object.keys(utm).length > 0;
  if (!isAd) return null;

  return { adId, source, type, ref, sourceUrl, placement, utm, raw: rawReferral };
};

const metaConfig = () => {
  const config = appConfig.integrations?.metaAds;
  const legacyAccessToken = config?.accessToken?.trim() ?? '';
  return {
    marketingAccessToken: config?.marketingAccessToken?.trim() || legacyAccessToken,
    capiAccessToken: config?.capiAccessToken?.trim() || legacyAccessToken,
    adAccountId: config?.adAccountId?.trim().replace(/^act_/, '') ?? '',
    businessId: config?.businessId?.trim() ?? '',
    datasetId: config?.datasetId?.trim() ?? '',
    pageId: config?.pageId?.trim() ?? '',
    apiVersion: config?.apiVersion?.trim() || 'v25.0',
    partnerAgent: config?.partnerAgent?.trim() || '01Academy_CRM',
    testEventCode: config?.testEventCode?.trim() ?? '',
    usdToUzsRate: Number(config?.usdToUzsRate ?? 0),
  };
};

export const getMetaMarketingIntegrationConfig = () => {
  const config = metaConfig();
  return {
    attributionConfigured: Boolean(config.marketingAccessToken && config.adAccountId),
    capiConfigured: Boolean(config.capiAccessToken && config.datasetId),
    accessTokenConfigured: Boolean(config.marketingAccessToken || config.capiAccessToken),
    adAccountId: config.adAccountId || null,
    businessId: config.businessId || null,
    datasetId: config.datasetId || null,
    pageId: config.pageId || null,
    apiVersion: config.apiVersion,
    testMode: Boolean(config.testEventCode),
    ...getMetaSpendCurrency(),
  };
};

const metaRetryAt = (attempt: number) => {
  const delaysMinutes = [1, 2, 5, 15, 60, 180, 360, 720];
  const minutes = delaysMinutes[Math.min(Math.max(attempt - 1, 0), delaysMinutes.length - 1)];
  return new Date(Date.now() + minutes * 60_000);
};

export const metaRetryDelayMinutes = (attempt: number) => {
  const retryAt = metaRetryAt(attempt);
  return Math.round((retryAt.getTime() - Date.now()) / 60_000);
};

const fetchMetaJson = async <T>(
  path: string,
  init: RequestInit = {},
  accessToken = metaConfig().marketingAccessToken,
): Promise<T> => {
  const config = metaConfig();
  const url = new URL(`${META_GRAPH_ORIGIN}/${config.apiVersion}/${path.replace(/^\/+/, '')}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > META_MAX_RESPONSE_BYTES) {
      throw new Error('Meta API response is too large');
    }
    let parsed: any = {};
    if (body) {
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error('Meta API returned invalid JSON');
      }
    }
    if (!response.ok || parsed?.error) {
      const error = parsed?.error ?? {};
      const message = [
        cleanText(error.message, 500) ?? `Meta API request failed (${response.status})`,
        cleanText(error.error_user_msg, 900),
      ].filter(Boolean).join(' — ');
      throw new Error(message);
    }
    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const direct = cleanText(value);
    if (direct) return direct;
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = cleanText(item?.text ?? item?.value ?? item?.name);
        if (nested) return nested;
      }
    }
  }
  return null;
};

const normalizeMetaPublicationUrl = (value: unknown): string | null => {
  const normalized = cleanText(value, 4_000);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const isMetaHost = hostname === 'instagram.com'
      || hostname.endsWith('.instagram.com')
      || hostname === 'facebook.com'
      || hostname.endsWith('.facebook.com');
    if (!isMetaHost || !['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
};

const META_MEDIA_HOST_SUFFIXES = ['fbcdn.net', 'cdninstagram.com', 'facebook.com', 'instagram.com'];

const normalizeMetaMediaUrl = (value: unknown): string | null => {
  const normalized = cleanText(value, 4_000);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    const allowed = META_MEDIA_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
};

// Meta scatters the creative preview across several shapes depending on the ad format,
// so the first host-approved https image wins.
export const extractMetaThumbnail = (creative: JsonObject): string | null => {
  const story = creative.object_story_spec ?? {};
  const assetFeed = creative.asset_feed_spec ?? {};
  const candidates = [
    creative.thumbnail_url,
    creative.image_url,
    story.video_data?.image_url,
    story.link_data?.picture,
    ...(Array.isArray(assetFeed.videos) ? assetFeed.videos.map((item: any) => item?.thumbnail_url) : []),
    ...(Array.isArray(assetFeed.images) ? assetFeed.images.map((item: any) => item?.url) : []),
    ...(Array.isArray(story.link_data?.child_attachments)
      ? story.link_data.child_attachments.map((item: any) => item?.picture)
      : []),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeMetaMediaUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
};

export const extractMetaPublication = (creative: JsonObject): { id: string | null; url: string | null } => {
  const instagramId = cleanText(
    creative.effective_instagram_media_id ?? creative.instagram_story_id,
    120,
  );
  const objectStoryId = cleanText(
    creative.effective_object_story_id ?? creative.object_story_id,
    120,
  );
  const directUrl = normalizeMetaPublicationUrl(creative.instagram_permalink_url);
  if (directUrl) return { id: instagramId || objectStoryId, url: directUrl };

  const storyMatch = objectStoryId?.match(/^(\d+)_(\d+)$/u);
  if (storyMatch) {
    return {
      id: objectStoryId,
      url: `https://www.facebook.com/${storyMatch[1]}/posts/${storyMatch[2]}`,
    };
  }
  return { id: instagramId || objectStoryId, url: null };
};

const creativeMediaType = (creative: JsonObject): string | null => {
  const objectType = cleanText(creative.object_type, 80)?.toLowerCase();
  const story = creative.object_story_spec ?? {};
  const assetFeed = creative.asset_feed_spec ?? {};
  if (objectType?.includes('video') || story.video_data || assetFeed.videos?.length) return 'video';
  if (objectType?.includes('carousel') || story.link_data?.child_attachments?.length) return 'carousel';
  if (objectType?.includes('image') || story.link_data?.image_hash || assetFeed.images?.length) return 'image';
  return objectType ?? null;
};

const creativeUtm = (creative: JsonObject) => {
  const story = creative.object_story_spec ?? {};
  const assetFeed = creative.asset_feed_spec ?? {};
  return extractMetaUtm(
    creative.url_tags,
    story.link_data?.link,
    story.video_data?.call_to_action?.value?.link,
    ...(Array.isArray(assetFeed.link_urls) ? assetFeed.link_urls.map((item: any) => item?.website_url) : []),
  );
};

const enrichMetaAttribution = async (row: MetaAttributionRow) => {
  if (!row.ad_id) return;
  const fields = [
    'id',
    'name',
    'campaign{id,name}',
    'adset{id,name}',
    'creative{id,name,title,body,object_type,url_tags,thumbnail_url,image_url,object_story_id,effective_object_story_id,effective_instagram_media_id,instagram_story_id,instagram_permalink_url,object_story_spec,asset_feed_spec}',
  ].join(',');
  const response = await fetchMetaJson<JsonObject>(`${encodeURIComponent(row.ad_id)}?fields=${encodeURIComponent(fields)}`);
  const creative = isPlainObject(response.creative) ? response.creative : {};
  const story = creative.object_story_spec ?? {};
  const assetFeed = creative.asset_feed_spec ?? {};
  const creativeTitle = firstText(
    creative.title,
    story.link_data?.name,
    story.video_data?.title,
    assetFeed.titles,
  );
  const creativeBody = firstText(
    creative.body,
    story.link_data?.message,
    story.video_data?.message,
    assetFeed.bodies,
  );
  const publication = extractMetaPublication(creative);
  const adName = cleanText(response.name);
  const campaignName = cleanText(response.campaign?.name);
  const hookName = extractMetaAdHook(adName, creative.name, creativeTitle, creativeBody);
  const declaredUtm = { ...(row.utm_values ?? {}), ...creativeUtm(creative) };
  const resolvedUtm = deriveMetaUtm({
    current: declaredUtm,
    channel: row.channel,
    campaignName,
    adName,
    hookName,
  });

  await pool.query(
    `UPDATE meta_lead_attributions
     SET ad_name = COALESCE($2, ad_name),
         campaign_id = COALESCE($3, campaign_id),
         campaign_name = COALESCE($4, campaign_name),
         adset_id = COALESCE($5, adset_id),
         adset_name = COALESCE($6, adset_name),
         creative_id = COALESCE($7, creative_id),
         creative_name = COALESCE($8, creative_name),
         creative_title = COALESCE($9, creative_title),
         creative_body = COALESCE($10, creative_body),
         media_type = COALESCE($11, media_type),
         source_url = COALESCE($12, source_url),
         hook_name = COALESCE($13, hook_name),
         utm_source = COALESCE($14, utm_source),
         utm_medium = COALESCE($15, utm_medium),
         utm_campaign = COALESCE($16, utm_campaign),
         utm_content = COALESCE($17, utm_content),
         utm_term = COALESCE($18, utm_term),
         utm_values = $19,
         utm_derived = utm_derived OR $20,
         thumbnail_url = COALESCE($21, thumbnail_url),
         enrichment_status = 'enriched',
         enriched_at = NOW(),
         enrichment_error = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [
      row.id,
      adName,
      cleanText(response.campaign?.id, 120),
      campaignName,
      cleanText(response.adset?.id, 120),
      cleanText(response.adset?.name),
      cleanText(creative.id, 120),
      cleanText(creative.name),
      creativeTitle,
      creativeBody,
      creativeMediaType(creative),
      publication.url,
      hookName,
      resolvedUtm.utm.utm_source ?? null,
      resolvedUtm.utm.utm_medium ?? null,
      resolvedUtm.utm.utm_campaign ?? null,
      resolvedUtm.utm.utm_content ?? null,
      resolvedUtm.utm.utm_term ?? null,
      JSON.stringify(resolvedUtm.utm),
      resolvedUtm.derived,
      extractMetaThumbnail(creative),
    ],
  );
};

const META_AD_CATALOG_FIELDS = [
  'id',
  'name',
  'effective_status',
  'created_time',
  'campaign{id,name}',
  'adset{id,name}',
  'creative{id,name,title,body,object_type,thumbnail_url,image_url,object_story_id,'
  + 'effective_object_story_id,effective_instagram_media_id,instagram_story_id,'
  + 'instagram_permalink_url,object_story_spec,asset_feed_spec}',
].join(',');

const META_AD_CATALOG_MAX_PAGES = 200;

const metaAdCatalogTimestamp = (value: unknown): Date | null => {
  const normalized = cleanText(value, 100);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const mapMetaAdToCatalogRow = (ad: JsonObject) => {
  const creative = isPlainObject(ad.creative) ? ad.creative : {};
  const story = creative.object_story_spec ?? {};
  const assetFeed = creative.asset_feed_spec ?? {};
  const creativeTitle = firstText(creative.title, story.link_data?.name, story.video_data?.title, assetFeed.titles);
  const creativeBody = firstText(creative.body, story.link_data?.message, story.video_data?.message, assetFeed.bodies);
  const adName = cleanText(ad.name);
  return {
    adId: cleanText(ad.id, 120),
    adName,
    adsetId: cleanText(ad.adset?.id, 120),
    adsetName: cleanText(ad.adset?.name),
    campaignId: cleanText(ad.campaign?.id, 120),
    campaignName: cleanText(ad.campaign?.name),
    creativeId: cleanText(creative.id, 120),
    creativeName: cleanText(creative.name),
    creativeTitle,
    creativeBody,
    mediaType: creativeMediaType(creative),
    hookName: extractMetaAdHook(adName, creative.name, creativeTitle, creativeBody),
    thumbnailUrl: extractMetaThumbnail(creative),
    sourceUrl: extractMetaPublication(creative).url,
    effectiveStatus: cleanText(ad.effective_status, 60),
    adCreatedTime: metaAdCatalogTimestamp(ad.created_time),
  };
};

/**
 * Pulls every ad in the account into `meta_ads`. Without it the marketing table can
 * only ever list ads that already produced a lead, which hides the ones that flopped.
 */
export const syncMetaAdCatalog = async () => {
  const config = metaConfig();
  if (!config.marketingAccessToken || !config.adAccountId) return { synced: 0, skipped: true };

  const visitedCursors = new Set<string>();
  let after: string | null = null;
  let synced = 0;

  for (let page = 0; page < META_AD_CATALOG_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ fields: META_AD_CATALOG_FIELDS, limit: '100' });
    if (after) params.set('after', after);
    const response = await fetchMetaJson<JsonObject>(
      `act_${encodeURIComponent(config.adAccountId)}/ads?${params.toString()}`,
    );
    const rows = Array.isArray(response.data) ? response.data : [];
    for (const raw of rows) {
      if (!isPlainObject(raw)) continue;
      const ad = mapMetaAdToCatalogRow(raw);
      if (!ad.adId) continue;
      await pool.query(
        `INSERT INTO meta_ads
           (ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
            creative_id, creative_name, creative_title, creative_body, media_type,
            hook_name, thumbnail_url, source_url, effective_status, ad_created_time,
            raw_payload, synced_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
         ON CONFLICT (ad_id) DO UPDATE SET
           ad_name = EXCLUDED.ad_name,
           adset_id = EXCLUDED.adset_id,
           adset_name = EXCLUDED.adset_name,
           campaign_id = EXCLUDED.campaign_id,
           campaign_name = EXCLUDED.campaign_name,
           creative_id = EXCLUDED.creative_id,
           creative_name = EXCLUDED.creative_name,
           creative_title = EXCLUDED.creative_title,
           creative_body = EXCLUDED.creative_body,
           media_type = EXCLUDED.media_type,
           hook_name = EXCLUDED.hook_name,
           thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, meta_ads.thumbnail_url),
           source_url = COALESCE(EXCLUDED.source_url, meta_ads.source_url),
           effective_status = EXCLUDED.effective_status,
           ad_created_time = COALESCE(EXCLUDED.ad_created_time, meta_ads.ad_created_time),
           raw_payload = EXCLUDED.raw_payload,
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          ad.adId, ad.adName, ad.adsetId, ad.adsetName, ad.campaignId, ad.campaignName,
          ad.creativeId, ad.creativeName, ad.creativeTitle, ad.creativeBody, ad.mediaType,
          ad.hookName, ad.thumbnailUrl, ad.sourceUrl, ad.effectiveStatus, ad.adCreatedTime,
          JSON.stringify(raw),
        ],
      );
      synced += 1;
    }

    const nextCursor = cleanText(response.paging?.cursors?.after, 500);
    if (!response.paging?.next || !nextCursor) break;
    if (visitedCursors.has(nextCursor)) throw new Error('Meta ad catalog pagination loop detected');
    visitedCursors.add(nextCursor);
    after = nextCursor;
  }

  logger.info('Meta ad catalog synced', { synced });
  return { synced, skipped: false };
};

const META_INSIGHTS_MAX_PAGES = 200;
const META_INSIGHTS_DEFAULT_DAYS = 14;
const META_INSIGHTS_BACKFILL_DAYS = 120;

const insightsDateKey = (date: Date) => date.toISOString().slice(0, 10);

const insightsInteger = (value: unknown) => {
  const parsed = Number(cleanText(value, 40) ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

const insightsSpend = (value: unknown) => {
  const parsed = Number(cleanText(value, 40) ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Daily spend per ad. Stored per day so any reporting range sums locally instead of
 * refetching. Meta keeps adjusting recent days, hence the rolling re-sync window.
 */
export const syncMetaAdInsights = async (days = META_INSIGHTS_DEFAULT_DAYS) => {
  const config = metaConfig();
  if (!config.marketingAccessToken || !config.adAccountId) return { synced: 0, skipped: true };

  const until = new Date();
  const since = new Date(until.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const timeRange = JSON.stringify({ since: insightsDateKey(since), until: insightsDateKey(until) });

  let after: string | null = null;
  const visitedCursors = new Set<string>();
  let synced = 0;

  for (let page = 0; page < META_INSIGHTS_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      level: 'ad',
      time_increment: '1',
      time_range: timeRange,
      fields: 'ad_id,spend,impressions,clicks,reach,account_currency',
      limit: '500',
    });
    if (after) params.set('after', after);
    const response = await fetchMetaJson<JsonObject>(
      `act_${encodeURIComponent(config.adAccountId)}/insights?${params.toString()}`,
    );

    const rows = Array.isArray(response.data) ? response.data : [];
    for (const raw of rows) {
      if (!isPlainObject(raw)) continue;
      const adId = cleanText(raw.ad_id, 120);
      const statDate = cleanText(raw.date_start, 20);
      if (!adId || !statDate) continue;
      await pool.query(
        `INSERT INTO meta_ad_insights
           (ad_id, stat_date, spend, impressions, clicks, reach, currency, synced_at, updated_at)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,NOW(),NOW())
         ON CONFLICT (ad_id, stat_date) DO UPDATE SET
           spend = EXCLUDED.spend,
           impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks,
           reach = EXCLUDED.reach,
           currency = COALESCE(EXCLUDED.currency, meta_ad_insights.currency),
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          adId,
          statDate,
          insightsSpend(raw.spend),
          insightsInteger(raw.impressions),
          insightsInteger(raw.clicks),
          insightsInteger(raw.reach),
          cleanText(raw.account_currency, 10),
        ],
      );
      synced += 1;
    }

    const nextCursor = cleanText(response.paging?.cursors?.after, 500);
    if (!response.paging?.next || !nextCursor) break;
    if (visitedCursors.has(nextCursor)) throw new Error('Meta insights pagination loop detected');
    visitedCursors.add(nextCursor);
    after = nextCursor;
  }

  logger.info('Meta ad insights synced', { synced, days });
  return { synced, skipped: false };
};

/** First run has nothing stored, so it reaches back far enough to cover past campaigns. */
export const syncMetaAdInsightsForSchedule = async () => {
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM meta_ad_insights');
  const isEmpty = Number(rows[0]?.count ?? 0) === 0;
  return syncMetaAdInsights(isEmpty ? META_INSIGHTS_BACKFILL_DAYS : META_INSIGHTS_DEFAULT_DAYS);
};

export const getMetaSpendCurrency = () => {
  const rate = Number(metaConfig().usdToUzsRate ?? 0);
  return {
    usdToUzsRate: Number.isFinite(rate) && rate > 0 ? rate : 0,
    convertsToUzs: Number.isFinite(rate) && rate > 0,
  };
};

const claimMetaAttributions = async (limit: number): Promise<MetaAttributionRow[]> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE meta_lead_attributions
       SET enrichment_status = 'failed',
           enrichment_error = COALESCE(enrichment_error, 'Meta enrichment worker interrupted'),
           next_enrichment_at = NOW(),
           updated_at = NOW()
       WHERE enrichment_status = 'processing'
         AND updated_at < NOW() - INTERVAL '10 minutes'`,
    );
    const { rows } = await client.query<MetaAttributionRow>(
      `WITH candidates AS (
         SELECT id
         FROM meta_lead_attributions
         WHERE enrichment_status IN ('pending', 'failed')
           AND ad_id IS NOT NULL
           AND next_enrichment_at <= NOW()
           AND enrichment_attempts < $1
         ORDER BY next_enrichment_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE meta_lead_attributions attribution
       SET enrichment_status = 'processing',
           enrichment_attempts = enrichment_attempts + 1,
           updated_at = NOW()
       FROM candidates
       WHERE attribution.id = candidates.id
       RETURNING attribution.*`,
      [META_MAX_ATTEMPTS, Math.max(1, Math.min(limit, 100))],
    );
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const processMetaAttributionEnrichment = async (limit = 20) => {
  const config = metaConfig();
  if (!config.marketingAccessToken || !config.adAccountId) return 0;
  const rows = await claimMetaAttributions(limit);
  for (const row of rows) {
    try {
      await enrichMetaAttribution(row);
    } catch (error) {
      const terminal = row.enrichment_attempts >= META_MAX_ATTEMPTS;
      await pool.query(
        `UPDATE meta_lead_attributions
         SET enrichment_status = 'failed',
             next_enrichment_at = $2,
             enrichment_error = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, terminal ? new Date('9999-12-31T00:00:00Z') : metaRetryAt(row.enrichment_attempts), cleanError(error)],
      );
      logger.warn('Meta ad attribution enrichment failed', { attributionId: row.id, error: cleanError(error) });
    }
  }
  return rows.length;
};

export const captureInstagramMetaAttribution = async (values: {
  client: PoolClient;
  conversationId: number;
  leadId?: number | null;
  event: unknown;
}) => {
  const referral = extractMetaReferral(values.event);
  if (!referral) return null;
  const resolvedUtm = deriveMetaUtm({ current: referral.utm, channel: 'instagram' });
  const { rows } = await values.client.query(
    `INSERT INTO meta_lead_attributions
       (lead_id, conversation_id, provider, channel, touch_type, ad_id, placement,
        referral_source, referral_type, referral_ref, source_url,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        utm_values, utm_derived, raw_payload, enrichment_status, next_enrichment_at, captured_at)
     VALUES ($1,$2,'meta','instagram','first_touch',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
     ON CONFLICT (conversation_id, touch_type) DO UPDATE SET
       lead_id = COALESCE(meta_lead_attributions.lead_id, EXCLUDED.lead_id),
       ad_id = COALESCE(meta_lead_attributions.ad_id, EXCLUDED.ad_id),
       placement = COALESCE(meta_lead_attributions.placement, EXCLUDED.placement),
       referral_source = COALESCE(meta_lead_attributions.referral_source, EXCLUDED.referral_source),
       referral_type = COALESCE(meta_lead_attributions.referral_type, EXCLUDED.referral_type),
       referral_ref = COALESCE(meta_lead_attributions.referral_ref, EXCLUDED.referral_ref),
       source_url = COALESCE(meta_lead_attributions.source_url, EXCLUDED.source_url),
       utm_source = COALESCE(meta_lead_attributions.utm_source, EXCLUDED.utm_source),
       utm_medium = COALESCE(meta_lead_attributions.utm_medium, EXCLUDED.utm_medium),
       utm_campaign = COALESCE(meta_lead_attributions.utm_campaign, EXCLUDED.utm_campaign),
       utm_content = COALESCE(meta_lead_attributions.utm_content, EXCLUDED.utm_content),
       utm_term = COALESCE(meta_lead_attributions.utm_term, EXCLUDED.utm_term),
       utm_values = meta_lead_attributions.utm_values || EXCLUDED.utm_values,
       utm_derived = meta_lead_attributions.utm_derived OR EXCLUDED.utm_derived,
       raw_payload = COALESCE(meta_lead_attributions.raw_payload, EXCLUDED.raw_payload),
       enrichment_status = CASE
         WHEN meta_lead_attributions.ad_id IS NULL AND EXCLUDED.ad_id IS NOT NULL THEN 'pending'
         ELSE meta_lead_attributions.enrichment_status
       END,
       next_enrichment_at = CASE
         WHEN meta_lead_attributions.ad_id IS NULL AND EXCLUDED.ad_id IS NOT NULL THEN NOW()
         ELSE meta_lead_attributions.next_enrichment_at
       END,
       updated_at = NOW()
     RETURNING *`,
    [
      values.leadId ?? null,
      values.conversationId,
      referral.adId,
      referral.placement,
      referral.source,
      referral.type,
      referral.ref,
      referral.sourceUrl,
      resolvedUtm.utm.utm_source ?? null,
      resolvedUtm.utm.utm_medium ?? null,
      resolvedUtm.utm.utm_campaign ?? null,
      resolvedUtm.utm.utm_content ?? null,
      resolvedUtm.utm.utm_term ?? null,
      JSON.stringify(resolvedUtm.utm),
      resolvedUtm.derived,
      JSON.stringify({ referral: referral.raw, timestamp: (values.event as any)?.timestamp ?? null }),
      referral.adId ? 'pending' : 'not_required',
    ],
  );
  return rows[0] ?? null;
};

export const linkMetaAttributionToLead = async (
  client: PoolClient,
  conversationId: number,
  leadId: number,
) => {
  await client.query(
    `UPDATE meta_lead_attributions
     SET lead_id = $2, updated_at = NOW()
     WHERE conversation_id = $1 AND lead_id IS NULL`,
    [conversationId, leadId],
  );
};

/** Meta wants E.164 digits only; the CRM also stores placeholders like `instagram:<id>`. */
export const hashMetaPhone = (value: unknown): string | null => {
  const normalized = cleanText(value, 40);
  if (!normalized || /[a-z]/i.test(normalized)) return null;
  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return crypto.createHash('sha256').update(digits).digest('hex');
};

/** Meta hashes are SHA256 over a lowercase, punctuation-free value. */
const hashMetaName = (value: unknown): string | null => {
  const normalized = cleanText(value, 120)
    ?.toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

/**
 * Meta scores how well it can recognise the people behind the events. A lead-form id
 * alone scores zero, so every extra identifier the CRM already holds is sent alongside it.
 */
export const buildMetaUserData = (row: {
  leadgen_id?: string | null;
  phone?: string | null;
  contact_name?: string | null;
}): JsonObject => {
  const userData: JsonObject = {};
  if (row.leadgen_id) userData.lead_id = String(row.leadgen_id);
  const phoneHash = hashMetaPhone(row.phone);
  if (phoneHash) userData.ph = [phoneHash];
  const nameParts = (cleanText(row.contact_name, 200) ?? '').split(' ').filter(Boolean);
  const firstName = hashMetaName(nameParts[0]);
  const lastName = hashMetaName(nameParts.slice(1).join(' '));
  if (firstName) userData.fn = [firstName];
  if (lastName) userData.ln = [lastName];
  return userData;
};

export const buildMetaCrmCustomData = (leadEventSource: unknown, data: JsonObject = {}): JsonObject => ({
  ...data,
  event_source: 'crm',
  lead_event_source: cleanText(leadEventSource, 120) ?? '01Academy_CRM',
});

type MetaLeadIdentityRow = {
  attribution_id: number | null;
  contact_name?: string | null;
  leadgen_id: string | null;
  ad_id: string | null;
  campaign_id: string | null;
  hook_name: string | null;
  phone: string | null;
};

/**
 * Conversion Leads CRM events only support the 15-16 digit Meta Lead ID downloaded with
 * an Instant Form submission. Instagram messaging conversions use a different payload.
 *
 * The Instagram conversation id is deliberately unused here. It only works with
 * action_source `business_messaging`, and Meta rejects custom event names on that source
 * ("Недействительный тип события переписки", subcode 2804066) — it accepts a short list
 * of standard events instead. Stage-named events therefore cannot travel that way.
 */
const resolveMetaLeadIdentity = (row: MetaLeadIdentityRow) => {
  const userData = buildMetaUserData(row);
  if (!userData.lead_id) return null;
  return {
    matchKey: 'leadgen_id',
    actionSource: 'system_generated',
    messagingChannel: null,
    userData: { lead_id: userData.lead_id },
  };
};

/**
 * Every pipeline stage becomes its own Meta event, so a campaign can be optimised for
 * whichever stage matters. Stage names are read live from the CRM, so adding or removing
 * a stage changes what Meta offers without a code change.
 */
export const enqueueMetaConversionForLead = async (lead: JsonObject, previousStatus?: string | null) => {
  const leadId = Number(lead?.id);
  const statusCode = cleanText(lead?.statusCode ?? lead?.status_code, 80);
  if (!Number.isSafeInteger(leadId) || leadId <= 0) return null;
  if (!statusCode || previousStatus === statusCode) return null;

  const { rows } = await pool.query<MetaLeadIdentityRow & {
    stage_name: string | null;
    meta_event_value: string | number | null;
    paid_amount: string | number | null;
  }>(
    `SELECT attribution.id AS attribution_id,
            attribution.leadgen_id,
            attribution.ad_id,
            attribution.campaign_id,
            attribution.hook_name,
            lead.phone,
            lead.contact_name,
            status.name AS stage_name,
            status.meta_event_value,
            paid.amount_uzs AS paid_amount
     FROM academy_leads lead
     LEFT JOIN academy_lead_statuses status ON status.code = lead.status_code
     LEFT JOIN LATERAL (
       SELECT inner_attribution.id, inner_attribution.leadgen_id, inner_attribution.ad_id,
              inner_attribution.campaign_id, inner_attribution.hook_name
       FROM meta_lead_attributions inner_attribution
       WHERE inner_attribution.lead_id = lead.id
       ORDER BY inner_attribution.captured_at, inner_attribution.id
       LIMIT 1
     ) attribution ON true
     LEFT JOIN LATERAL (
       SELECT SUM(payment.amount_uzs)::bigint AS amount_uzs
       FROM academy_payments payment
       WHERE payment.lead_id = lead.id AND payment.status = 'paid'
     ) paid ON true
     WHERE lead.id = $1`,
    [leadId],
  );
  const row = rows[0];
  if (!row) return null;

  const identity = resolveMetaLeadIdentity(row);
  if (!identity) return null;

  const eventName = cleanText(row.stage_name, 60) ?? statusCode;
  const eventId = `crm:${leadId}:${statusCode}`;
  const paidAmount = Number(row.paid_amount ?? 0);
  const stageValue = Number(row.meta_event_value ?? 0);
  const conversionValue = paidAmount > 0 ? paidAmount : (stageValue > 0 ? stageValue : null);
  const customData = buildMetaCrmCustomData(metaConfig().partnerAgent, {
    crm_stage: statusCode,
    ...(conversionValue !== null ? { value: conversionValue, currency: 'UZS' } : {}),
    ...(row.stage_name ? { crm_stage_name: cleanText(row.stage_name, 200) } : {}),
    ...(row.ad_id ? { source_ad_id: String(row.ad_id) } : {}),
    ...(row.campaign_id ? { source_campaign_id: String(row.campaign_id) } : {}),
    ...(row.hook_name ? { creative_hook: String(row.hook_name) } : {}),
  });

  const { rows: inserted } = await pool.query(
    `INSERT INTO meta_conversion_events
       (lead_id, attribution_id, event_id, event_name, crm_stage, event_time,
        action_source, messaging_channel, match_key, user_data, custom_data, status, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',NOW())
     ON CONFLICT (event_id) DO NOTHING
     RETURNING *`,
    [
      leadId,
      row.attribution_id ?? null,
      eventId,
      eventName,
      statusCode,
      new Date(),
      identity.actionSource,
      identity.messagingChannel,
      identity.matchKey,
      JSON.stringify(identity.userData),
      JSON.stringify(customData),
    ],
  );
  return inserted[0] ?? null;
};

export const enqueueRecentMetaCrmHistory = async () => {
  const config = metaConfig();
  if (!config.capiAccessToken || !config.datasetId) return 0;

  const { rows } = await pool.query<{ count: number }>(
    `WITH eligible AS (
       SELECT history.id AS history_id,
              history.lead_id,
              history.to_status_code,
              history.entered_at,
              status.name AS stage_name,
              attribution.id AS attribution_id,
              attribution.leadgen_id,
              attribution.ad_id,
              attribution.campaign_id,
              attribution.hook_name
       FROM academy_lead_stage_history history
       JOIN academy_lead_statuses status ON status.code = history.to_status_code
       JOIN LATERAL (
         SELECT inner_attribution.id,
                inner_attribution.leadgen_id,
                inner_attribution.ad_id,
                inner_attribution.campaign_id,
                inner_attribution.hook_name,
                inner_attribution.captured_at
         FROM meta_lead_attributions inner_attribution
         WHERE inner_attribution.lead_id = history.lead_id
           AND inner_attribution.leadgen_id ~ '^[0-9]{15,16}$'
         ORDER BY inner_attribution.captured_at, inner_attribution.id
         LIMIT 1
       ) attribution ON true
       WHERE history.entered_at >= NOW() - INTERVAL '7 days'
         AND history.entered_at <= NOW()
         AND history.entered_at >= attribution.captured_at
         AND NOT EXISTS (
           SELECT 1
           FROM meta_conversion_events existing
           WHERE existing.lead_id = history.lead_id
             AND existing.crm_stage = history.to_status_code
             AND existing.custom_data ->> 'event_source' = 'crm'
             AND NULLIF(BTRIM(existing.custom_data ->> 'lead_event_source'), '') IS NOT NULL
             AND existing.event_time BETWEEN history.entered_at - INTERVAL '2 minutes'
                                         AND history.entered_at + INTERVAL '2 minutes'
         )
     ), inserted AS (
       INSERT INTO meta_conversion_events
         (lead_id, attribution_id, event_id, event_name, crm_stage, event_time,
          action_source, messaging_channel, match_key, user_data, custom_data,
          status, next_attempt_at)
       SELECT eligible.lead_id,
              eligible.attribution_id,
              'crm-history:' || eligible.history_id,
              LEFT(COALESCE(NULLIF(BTRIM(eligible.stage_name), ''), eligible.to_status_code), 60),
              eligible.to_status_code,
              eligible.entered_at,
              'system_generated',
              NULL,
              'leadgen_id',
              jsonb_build_object('lead_id', eligible.leadgen_id),
              jsonb_strip_nulls(jsonb_build_object(
                'event_source', 'crm',
                'lead_event_source', $1::text,
                'crm_stage', eligible.to_status_code,
                'crm_stage_name', eligible.stage_name,
                'source_ad_id', eligible.ad_id,
                'source_campaign_id', eligible.campaign_id,
                'creative_hook', eligible.hook_name
              )),
              'pending',
              NOW()
       FROM eligible
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id
     )
     SELECT COUNT(*)::int AS count FROM inserted`,
    [config.partnerAgent],
  );
  return Number(rows[0]?.count ?? 0);
};

const claimMetaConversionEvents = async (limit: number): Promise<MetaConversionRow[]> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE meta_conversion_events
       SET status = 'failed',
           error_message = COALESCE(error_message, 'Meta CAPI worker interrupted'),
           next_attempt_at = NOW(),
           updated_at = NOW()
       WHERE status = 'processing'
         AND updated_at < NOW() - INTERVAL '10 minutes'`,
    );
    const { rows } = await client.query<MetaConversionRow>(
      `WITH candidates AS (
         SELECT id
         FROM meta_conversion_events
         WHERE status IN ('pending', 'failed')
           AND next_attempt_at <= NOW()
           AND attempt_count < $1
         ORDER BY next_attempt_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE meta_conversion_events event
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           last_attempt_at = NOW(),
           updated_at = NOW()
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.*`,
      [META_MAX_ATTEMPTS, Math.max(1, Math.min(limit, 100))],
    );
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const dispatchMetaConversionEvent = async (event: MetaConversionRow) => {
  const config = metaConfig();
  const payload: JsonObject = {
    data: [{
      event_name: event.event_name,
      event_time: Math.floor(new Date(event.event_time).getTime() / 1_000),
      event_id: event.event_id,
      action_source: event.action_source,
      ...(event.messaging_channel ? { messaging_channel: event.messaging_channel } : {}),
      user_data: event.user_data,
      custom_data: event.custom_data,
    }],
    partner_agent: config.partnerAgent,
  };
  if (config.testEventCode) payload.test_event_code = config.testEventCode;
  const response = await fetchMetaJson<JsonObject>(
    `${encodeURIComponent(config.datasetId)}/events`,
    { method: 'POST', body: JSON.stringify(payload) },
    config.capiAccessToken,
  );
  await pool.query(
    `UPDATE meta_conversion_events
     SET status = 'sent',
         sent_at = NOW(),
         response_payload = $2,
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [event.id, JSON.stringify(response)],
  );
};

export const processMetaConversionEvents = async (limit = 50) => {
  const config = metaConfig();
  if (!config.capiAccessToken || !config.datasetId) return 0;
  const rows = await claimMetaConversionEvents(limit);
  for (const row of rows) {
    try {
      await dispatchMetaConversionEvent(row);
    } catch (error) {
      const terminal = row.attempt_count >= META_MAX_ATTEMPTS;
      await pool.query(
        `UPDATE meta_conversion_events
         SET status = 'failed',
             next_attempt_at = $2,
             error_message = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, terminal ? new Date('9999-12-31T00:00:00Z') : metaRetryAt(row.attempt_count), cleanError(error)],
      );
      logger.warn('Meta CAPI event dispatch failed', { eventId: row.event_id, error: cleanError(error) });
    }
  }
  return rows.length;
};

export const retryMetaConversionEvent = async (id: number) => {
  const { rows } = await pool.query(
    `UPDATE meta_conversion_events
     SET status = 'pending',
         attempt_count = 0,
         next_attempt_at = NOW(),
         last_attempt_at = NULL,
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $1 AND status <> 'sent'
     RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
};
