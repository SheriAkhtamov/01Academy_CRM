import crypto from 'node:crypto';
import { appConfig } from '../config';
import { pool } from '../db';
import { logger } from '../lib/logger';
import {
  buildLeadImportComment,
  importLeadRecords,
  type LeadImportRecord,
  type LeadImportSummary,
} from './lead-import';
import { deriveMetaUtm, extractMetaAdHook } from './meta-marketing';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';
const META_LEAD_FETCH_TIMEOUT_MS = 20_000;
const META_LEAD_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const META_LEAD_FIELDS = [
  'id',
  'created_time',
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'form_id',
  'field_data',
  'platform',
  'is_organic',
  'custom_disclaimer_responses',
].join(',');

type JsonObject = Record<string, any>;

type MetaLeadWebhookValue = {
  leadgen_id?: string | number;
  page_id?: string | number;
  form_id?: string | number;
  adgroup_id?: string | number;
  ad_id?: string | number;
  created_time?: string | number;
};

type MetaLeadField = {
  name?: unknown;
  values?: unknown;
};

const text = (value: unknown, maxLength = 1_000): string | null => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const metaLeadAdsConfig = () => {
  const metaAds = appConfig.integrations?.metaAds;
  const instagram = appConfig.integrations?.instagram;
  return {
    pageId: metaAds?.pageId?.trim() ?? '',
    apiVersion: metaAds?.apiVersion?.trim() || instagram?.apiVersion?.trim() || 'v25.0',
    accessToken: metaAds?.leadAccessToken?.trim() ?? '',
    appSecret: metaAds?.webhookAppSecret?.trim() || instagram?.appSecret?.trim() || '',
    verifyToken: metaAds?.leadWebhookVerifyToken?.trim() || instagram?.verifyToken?.trim() || '',
  };
};

export const getMetaLeadAdsIntegrationConfig = () => {
  const config = metaLeadAdsConfig();
  const appUrl = appConfig.server.appUrl.replace(/\/$/, '');
  return {
    configured: Boolean(
      config.pageId
      && config.accessToken
      && config.appSecret
      && config.verifyToken
    ),
    pageId: config.pageId || null,
    accessTokenConfigured: Boolean(config.accessToken),
    appSecretConfigured: Boolean(config.appSecret),
    verifyTokenConfigured: Boolean(config.verifyToken),
    apiVersion: config.apiVersion,
    webhookUrl: `${appUrl}/api/incoming/meta-leads`,
  };
};

export const verifyMetaLeadWebhookChallenge = (mode: unknown, token: unknown) => {
  const expected = metaLeadAdsConfig().verifyToken;
  return mode === 'subscribe' && Boolean(expected) && token === expected;
};

export const verifyMetaLeadWebhookSignature = (
  rawBody: Buffer | undefined,
  signature: string | undefined,
) => {
  const appSecret = metaLeadAdsConfig().appSecret;
  if (!appSecret) return appConfig.server.environment !== 'production';
  if (!rawBody || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(signature);
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
};

const normalizedFieldName = (value: unknown) => (
  text(value)?.toLocaleLowerCase('ru-RU').replace(/[\s-]+/g, '_') ?? ''
);

const fieldValues = (field: MetaLeadField): unknown[] => {
  if (Array.isArray(field.values)) return field.values;
  if (field.values === undefined || field.values === null) return [];
  return [field.values];
};

const firstScalarValue = (field: MetaLeadField | undefined): string | null => {
  if (!field) return null;
  for (const value of fieldValues(field)) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
};

const findField = (fields: MetaLeadField[], names: RegExp[]) => fields.find((field) => {
  const name = normalizedFieldName(field.name);
  return names.some((pattern) => pattern.test(name));
});

const metaTimestamp = (value: unknown): string | null => {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const numeric = Number(value);
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const normalized = text(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? normalized : date.toISOString();
};

export const mapMetaLeadToImportRecord = (
  lead: JsonObject,
  webhookValue: MetaLeadWebhookValue = {},
  formName?: string | null,
): LeadImportRecord => {
  const rawFields = Array.isArray(lead.field_data) ? lead.field_data : [];
  const fields: MetaLeadField[] = rawFields.filter((field): field is MetaLeadField => (
    Boolean(field) && typeof field === 'object'
  ));
  const fullName = firstScalarValue(findField(fields, [
    /^full_name$/,
    /^contact_name$/,
    /^parent_name$/,
    /^фио$/u,
    /^имя(?:_родителя)?$/u,
  ]));
  const firstName = firstScalarValue(findField(fields, [/^first_name$/, /^имя$/u]));
  const lastName = firstScalarValue(findField(fields, [/^last_name$/, /^фамилия$/u]));
  const phone = firstScalarValue(findField(fields, [
    /^phone(?:_number)?$/,
    /^mobile(?:_phone|_number)?$/,
    /^номер_телефона$/u,
    /^телефон$/u,
  ]));
  const childAge = firstScalarValue(findField(fields, [
    /child.*age/,
    /age.*child/,
    /возраст.*реб/u,
  ]));
  const city = firstScalarValue(findField(fields, [/^city$/, /^город$/u, /location/])) ?? null;
  const learningFormat = firstScalarValue(findField(fields, [
    /offline/,
    /learning.*format/,
    /формат.*обуч/u,
  ]));
  const occupation = firstScalarValue(findField(fields, [
    /occupation/,
    /job/,
    /сфера.*деятель/u,
  ]));
  const leadgenId = text(lead.id ?? webhookValue.leadgen_id, 255) ?? '';
  const resolvedFormId = text(lead.form_id ?? webhookValue.form_id, 255);
  const resolvedFormName = text(formName, 500) ?? (resolvedFormId ? `Meta Instant Form ${resolvedFormId}` : 'Meta Instant Form');
  const contactName = fullName ?? ([firstName, lastName].filter(Boolean).join(' ') || null);
  const isNamedTestLead = Boolean(contactName && /\btest[\s_-]*lead\b/i.test(contactName));
  const disclaimerResponses = Array.isArray(lead.custom_disclaimer_responses)
    ? lead.custom_disclaimer_responses.map((response: JsonObject) => ({
      name: text(response?.checkbox_key ?? response?.name, 500) ?? 'Согласие',
      value: response?.is_checked ?? response?.value ?? null,
    }))
    : [];

  return {
    externalId: leadgenId,
    sheet: resolvedFormName,
    createdTime: metaTimestamp(lead.created_time ?? webhookValue.created_time),
    contactName,
    phone,
    rawPhone: phone,
    campaignName: text(lead.campaign_name, 500),
    campaignId: text(lead.campaign_id, 120),
    adsetName: text(lead.adset_name, 500),
    adsetId: text(lead.adset_id ?? webhookValue.adgroup_id, 120),
    adName: text(lead.ad_name, 500),
    adId: text(lead.ad_id ?? webhookValue.ad_id, 120),
    formName: resolvedFormName,
    formId: resolvedFormId,
    platform: text(lead.platform, 120) ?? 'instagram',
    isOrganic: typeof lead.is_organic === 'boolean' ? lead.is_organic : null,
    childAgeAnswer: childAge,
    cityAnswer: city,
    offlineAnswer: learningFormat,
    occupationAnswer: occupation,
    answers: fields.map((field) => ({
      name: text(field.name, 500) ?? 'Поле без названия',
      values: fieldValues(field),
    })),
    disclaimerResponses,
    test: lead.is_test === true || lead.test_lead === true || isNamedTestLead,
    rawMetaLead: lead,
    rawWebhookValue: webhookValue,
  };
};

const fetchMetaObject = async <T extends JsonObject>(id: string, fields: string): Promise<T> => {
  const config = metaLeadAdsConfig();
  if (!config.accessToken) throw new Error('Meta Lead Ads access token is not configured');
  const url = new URL(`${META_GRAPH_ORIGIN}/${config.apiVersion}/${encodeURIComponent(id)}`);
  url.searchParams.set('fields', fields);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_LEAD_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await response.text();
    if (Buffer.byteLength(body) > META_LEAD_MAX_RESPONSE_BYTES) {
      throw new Error('Meta Lead Ads response exceeded the size limit');
    }
    let parsed: JsonObject;
    try {
      parsed = JSON.parse(body) as JsonObject;
    } catch {
      throw new Error(`Meta Lead Ads returned invalid JSON (${response.status})`);
    }
    if (!response.ok || parsed.error) {
      const message = text(parsed.error?.message, 2_000) ?? `Meta Lead Ads request failed (${response.status})`;
      throw new Error(message);
    }
    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchMetaLead = (leadgenId: string) => fetchMetaObject<JsonObject>(leadgenId, META_LEAD_FIELDS);

const fetchMetaFormName = async (formId: string): Promise<string | null> => {
  try {
    const form = await fetchMetaObject<JsonObject>(formId, 'id,name');
    return text(form.name, 500);
  } catch (error) {
    logger.warn('Failed to enrich Meta lead form name', {
      formId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const linkMetaLeadAttribution = async (record: LeadImportRecord) => {
  const externalId = text(record.externalId, 255);
  if (!externalId) return;
  const imported = await pool.query<{ lead_id: number | null }>(
    `SELECT lead_id
     FROM academy_lead_import_records
     WHERE provider = 'meta_lead_ads_live' AND external_id = $1
     LIMIT 1`,
    [externalId],
  );
  const leadId = Number(imported.rows[0]?.lead_id);
  if (!Number.isSafeInteger(leadId) || leadId <= 0) return;

  const { utm, derived } = deriveMetaUtm({
    channel: record.platform || 'instagram',
    campaignName: record.campaignName,
    adName: record.adName,
    hookName: extractMetaAdHook(record.adName),
  });
  const capturedAt = record.createdTime && !Number.isNaN(new Date(record.createdTime).getTime())
    ? new Date(record.createdTime)
    : new Date();
  await pool.query(
    `INSERT INTO meta_lead_attributions
       (lead_id, conversation_id, leadgen_id, form_id, provider, channel, touch_type,
        ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, hook_name,
        placement, referral_source, referral_type,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        utm_values, utm_derived, raw_payload, enrichment_status, captured_at)
     VALUES
       ($1,NULL,$2,$3,'meta','instant_form','first_touch',
        $4,$5,$6,$7,$8,$9,$10,
        $11,'instant_form','leadgen',
        $12,$13,$14,$15,$16,
        $17::jsonb,$18,$19::jsonb,$20,$21)
     ON CONFLICT DO NOTHING`,
    [
      leadId,
      externalId,
      text(record.formId, 255),
      text(record.adId, 120),
      text(record.adName, 500),
      text(record.adsetId, 120),
      text(record.adsetName, 500),
      text(record.campaignId, 120),
      text(record.campaignName, 500),
      extractMetaAdHook(record.adName),
      text(record.platform, 120),
      utm.utm_source ?? null,
      utm.utm_medium ?? null,
      utm.utm_campaign ?? null,
      utm.utm_content ?? null,
      utm.utm_term ?? null,
      JSON.stringify(utm),
      derived,
      JSON.stringify({
        lead: record.rawMetaLead,
        webhook: record.rawWebhookValue,
        comment: buildLeadImportComment(record, 'Meta Instant Forms'),
      }),
      record.adId ? 'pending' : 'not_required',
      capturedAt,
    ],
  );
};

const emptySummary = (): LeadImportSummary => ({
  created: 0,
  merged: 0,
  mergedArchived: 0,
  skippedTest: 0,
  skippedInvalid: 0,
  alreadyImported: 0,
});

const mergeSummary = (target: LeadImportSummary, source: LeadImportSummary) => {
  target.created += source.created;
  target.merged += source.merged;
  target.mergedArchived += source.mergedArchived;
  target.skippedTest += source.skippedTest;
  target.skippedInvalid += source.skippedInvalid;
  target.alreadyImported += source.alreadyImported;
};

export const processMetaLeadAdsWebhook = async (payload: JsonObject) => {
  if (payload?.object !== 'page' || !Array.isArray(payload.entry)) {
    return { processed: 0, summary: emptySummary() };
  }
  const config = metaLeadAdsConfig();
  if (!config.accessToken || !config.pageId) {
    throw new Error('Meta Lead Ads integration is not configured');
  }

  const values: MetaLeadWebhookValue[] = [];
  const seen = new Set<string>();
  for (const entry of payload.entry) {
    const entryPageId = text(entry?.id, 120);
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== 'leadgen' || !change?.value) continue;
      const value = change.value as MetaLeadWebhookValue;
      const pageId = text(value.page_id ?? entryPageId, 120);
      const leadgenId = text(value.leadgen_id, 255);
      if (!leadgenId || pageId !== config.pageId || seen.has(leadgenId)) continue;
      seen.add(leadgenId);
      values.push(value);
    }
  }

  const summary = emptySummary();
  for (const value of values) {
    const leadgenId = text(value.leadgen_id, 255)!;
    const lead = await fetchMetaLead(leadgenId);
    const formId = text(lead.form_id ?? value.form_id, 255);
    const formName = formId ? await fetchMetaFormName(formId) : null;
    const record = mapMetaLeadToImportRecord(lead, value, formName);
    const imported = await importLeadRecords(pool, [record], {
      provider: 'meta_lead_ads_live',
      providerLabel: 'Meta Instant Forms',
      sourceCode: 'meta_lead_ads',
      sourceName: 'Meta Lead Ads',
      allowMissingPhone: true,
      createFollowUpTask: true,
    });
    mergeSummary(summary, imported);
    await linkMetaLeadAttribution(record);
  }

  return { processed: values.length, summary };
};
