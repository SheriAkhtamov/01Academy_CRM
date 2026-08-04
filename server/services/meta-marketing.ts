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
  messaging_channel: string;
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
    conversionStageCode: config?.conversionStageCode?.trim() || 'demo_invited',
    conversionEventName: config?.conversionEventName?.trim() || 'LeadSubmitted',
    partnerAgent: config?.partnerAgent?.trim() || '01Academy_CRM',
    testEventCode: config?.testEventCode?.trim() ?? '',
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
    conversionStageCode: config.conversionStageCode,
    conversionEventName: config.conversionEventName,
    testMode: Boolean(config.testEventCode),
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
      const message = cleanText(parsed?.error?.message, 1_500) ?? `Meta API request failed (${response.status})`;
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
    'creative{id,name,title,body,object_type,url_tags,object_story_id,effective_object_story_id,effective_instagram_media_id,instagram_story_id,instagram_permalink_url,object_story_spec,asset_feed_spec}',
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
    ],
  );
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

export const enqueueMetaConversionForLead = async (lead: JsonObject, previousStatus?: string | null) => {
  const config = metaConfig();
  const leadId = Number(lead?.id);
  const statusCode = cleanText(lead?.statusCode ?? lead?.status_code, 80);
  if (!Number.isSafeInteger(leadId) || leadId <= 0) return null;
  if (statusCode !== config.conversionStageCode || previousStatus === statusCode) return null;

  const { rows: channelRows } = await pool.query(
    `SELECT channel.external_id AS ig_sid,
            channel.provider_account_id AS instagram_business_account_id,
            attribution.id AS attribution_id,
            attribution.ad_id,
            attribution.campaign_id,
            attribution.hook_name
     FROM academy_lead_channels channel
     LEFT JOIN LATERAL (
       SELECT attribution_inner.id, attribution_inner.ad_id,
              attribution_inner.campaign_id, attribution_inner.hook_name
       FROM meta_lead_attributions attribution_inner
       WHERE attribution_inner.lead_id = channel.lead_id
         AND attribution_inner.channel = 'instagram'
       ORDER BY attribution_inner.captured_at, attribution_inner.id
       LIMIT 1
     ) attribution ON true
     WHERE channel.lead_id = $1
       AND channel.channel = 'instagram'
       AND channel.external_id IS NOT NULL
       AND BTRIM(channel.external_id) <> ''
       AND channel.provider_account_id <> ''
     ORDER BY channel.updated_at DESC, channel.id DESC
     LIMIT 1`,
    [leadId],
  );
  const channel = channelRows[0];
  if (!channel) return null;

  const eventId = `crm:${leadId}:${config.conversionStageCode}`;
  const userData = {
    instagram_business_account_id: String(channel.instagram_business_account_id),
    ig_sid: String(channel.ig_sid),
  };
  const customData = {
    crm_stage: config.conversionStageCode,
    ...(channel.ad_id ? { source_ad_id: String(channel.ad_id) } : {}),
    ...(channel.campaign_id ? { source_campaign_id: String(channel.campaign_id) } : {}),
    ...(channel.hook_name ? { creative_hook: String(channel.hook_name) } : {}),
  };
  const eventTime = new Date();
  const { rows } = await pool.query(
    `INSERT INTO meta_conversion_events
       (lead_id, attribution_id, event_id, event_name, crm_stage, event_time,
        action_source, messaging_channel, user_data, custom_data, status, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,'business_messaging','instagram',$7,$8,'pending',NOW())
     ON CONFLICT (event_id) DO NOTHING
     RETURNING *`,
    [
      leadId,
      channel.attribution_id ?? null,
      eventId,
      config.conversionEventName,
      config.conversionStageCode,
      eventTime,
      JSON.stringify(userData),
      JSON.stringify(customData),
    ],
  );
  return rows[0] ?? null;
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
      messaging_channel: event.messaging_channel,
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
