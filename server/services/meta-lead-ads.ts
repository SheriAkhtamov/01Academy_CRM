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
import { fetchMetaGraphJson } from './meta-graph';
import { hasChildImportContext, importText, leadImportAnswerKind, resolveLeadImportFields, type LeadImportAnswerKind } from './lead-import-fields';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';
const META_LEAD_BACKFILL_MAX_PAGES = 1_000;
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

type MetaLeadForm = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
};

export type MetaLeadAdsBackfillResult = {
  forms: number;
  failedForms: number;
  records: number;
  summary: LeadImportSummary;
  formSummaries: Array<{
    formId: string;
    formName: string;
    status: string | null;
    records: number;
  }>;
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

const fieldValues = (field: MetaLeadField): unknown[] => {
  if (Array.isArray(field.values)) return field.values;
  if (field.values === undefined || field.values === null) return [];
  return [field.values];
};

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
  const answers = fields.map(field => ({
    name: text(field.name, 500) ?? 'Поле без названия',
    values: fieldValues(field),
  }));
  const mapped = resolveLeadImportFields({ answers });
  const childContext = hasChildImportContext({ answers });
  const firstAnswer = (kind: LeadImportAnswerKind) => answers
    .filter(answer => leadImportAnswerKind(answer.name, childContext) === kind)
    .flatMap(answer => answer.values).map(importText).find(Boolean) ?? null;
  const leadgenId = text(lead.id ?? webhookValue.leadgen_id, 255) ?? '';
  const resolvedFormId = text(lead.form_id ?? webhookValue.form_id, 255);
  const resolvedFormName = text(formName, 500) ?? (resolvedFormId ? `Meta Instant Form ${resolvedFormId}` : 'Meta Instant Form');
  const contactName = mapped.contactName;
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
    ...mapped,
    contactName,
    phone: mapped.phoneNumbers[0] ?? null,
    rawPhone: firstAnswer('phoneNumbers'),
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
    childAgeAnswer: firstAnswer('studentAge'),
    cityAnswer: firstAnswer('locality'),
    offlineAnswer: firstAnswer('format'),
    occupationAnswer: firstAnswer('occupation'),
    answers,
    disclaimerResponses,
    test: lead.is_test === true || lead.test_lead === true || isNamedTestLead,
    rawMetaLead: lead,
    rawWebhookValue: webhookValue,
  };
};

const fetchMetaUrl = async <T extends JsonObject>(url: URL): Promise<T> => {
  const config = metaLeadAdsConfig();
  if (!config.accessToken) throw new Error('Meta Lead Ads access token is not configured');
  return fetchMetaGraphJson<T>(url, config.accessToken);
};

const fetchMetaObject = async <T extends JsonObject>(id: string, fields: string): Promise<T> => {
  const config = metaLeadAdsConfig();
  const url = new URL(`${META_GRAPH_ORIGIN}/${config.apiVersion}/${encodeURIComponent(id)}`);
  url.searchParams.set('fields', fields);
  return fetchMetaUrl<T>(url);
};

const fetchMetaLeadCollection = async (
  path: string,
  fields: string,
  options: { since?: Date } = {},
): Promise<JsonObject[]> => {
  const config = metaLeadAdsConfig();
  let nextUrl = new URL(`${META_GRAPH_ORIGIN}/${config.apiVersion}/${path.replace(/^\/+/, '')}`);
  nextUrl.searchParams.set('fields', fields);
  nextUrl.searchParams.set('limit', '100');
  if (options.since) {
    nextUrl.searchParams.set('filtering', JSON.stringify([{
      field: 'time_created',
      operator: 'GREATER_THAN',
      value: Math.floor(options.since.getTime() / 1_000),
    }]));
  }
  const rows: JsonObject[] = [];
  const visitedPages = new Set<string>();

  for (let page = 0; page < META_LEAD_BACKFILL_MAX_PAGES; page += 1) {
    const pageKey = nextUrl.toString();
    if (visitedPages.has(pageKey)) {
      throw new Error('Meta Lead Ads pagination loop detected');
    }
    visitedPages.add(pageKey);
    const response = await fetchMetaUrl<JsonObject>(nextUrl);
    if (Array.isArray(response.data)) {
      rows.push(...response.data.filter((item): item is JsonObject => Boolean(item) && typeof item === 'object'));
    }
    const next = response.paging?.next;
    if (typeof next !== 'string' || !next.trim()) return rows;
    try {
      nextUrl = new URL(next);
    } catch {
      throw new Error('Meta Lead Ads returned an invalid pagination URL');
    }
  }
  throw new Error(`Meta Lead Ads pagination exceeded ${META_LEAD_BACKFILL_MAX_PAGES} pages`);
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
        comment: buildLeadImportComment(record),
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

const importMetaLeadValue = async (
  value: MetaLeadWebhookValue,
  createFollowUpTask: boolean,
) => {
  const leadgenId = text(value.leadgen_id, 255);
  if (!leadgenId) throw new Error('Meta Lead Ads lead ID is required');
  const lead = await fetchMetaLead(leadgenId);
  const formId = text(lead.form_id ?? value.form_id, 255);
  const formName = formId ? await fetchMetaFormName(formId) : null;
  const record = mapMetaLeadToImportRecord(lead, value, formName);
  const imported = await importLeadRecords(pool, [record], {
    provider: 'meta_lead_ads_live',
    sourceCode: 'meta_lead_ads',
    sourceName: 'Meta Lead Ads',
    allowMissingPhone: true,
    createFollowUpTask,
    restoreArchivedMatches: true,
  });
  await linkMetaLeadAttribution(record);
  return imported;
};

export const importMetaLeadAdsByIds = async (leadgenIds: string[]) => {
  const config = metaLeadAdsConfig();
  if (!config.accessToken || !config.pageId) {
    throw new Error('Meta Lead Ads integration is not configured');
  }
  const ids = [...new Set(leadgenIds.map((id) => text(id, 255)).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0 || ids.some((id) => !/^\d{10,30}$/.test(id))) {
    throw new Error('Meta Lead Ads lead IDs must contain 10 to 30 digits');
  }

  const summary = emptySummary();
  for (const leadgenId of ids) {
    mergeSummary(summary, await importMetaLeadValue({ leadgen_id: leadgenId }, true));
  }
  return { processed: ids.length, summary };
};

export const importHistoricalMetaLeadAds = async (options: {
  since?: Date;
  createFollowUpTask?: boolean;
} = {}): Promise<MetaLeadAdsBackfillResult> => {
  const config = metaLeadAdsConfig();
  if (!config.accessToken || !config.pageId) {
    throw new Error('Meta Lead Ads integration is not configured');
  }

  const forms = await fetchMetaLeadCollection(`${encodeURIComponent(config.pageId)}/leadgen_forms`, 'id,name,status');
  const summary = emptySummary();
  const formSummaries: MetaLeadAdsBackfillResult['formSummaries'] = [];
  let records = 0;
  let failedForms = 0;

  for (const rawForm of forms) {
    const form = rawForm as MetaLeadForm;
    const formId = text(form.id, 255);
    if (!formId) continue;
    const formName = text(form.name, 500) ?? `Meta Instant Form ${formId}`;
    try {
      const leads = await fetchMetaLeadCollection(
        `${encodeURIComponent(formId)}/leads`,
        META_LEAD_FIELDS,
        { since: options.since },
      );
      const leadRecords = leads.map((lead) => mapMetaLeadToImportRecord(
        { ...lead, form_id: lead.form_id ?? formId },
        { form_id: formId },
        formName,
      ));
      if (leadRecords.length === 0) {
        formSummaries.push({
          formId,
          formName,
          status: text(form.status, 120),
          records: 0,
        });
        continue;
      }
      const imported = await importLeadRecords(pool, leadRecords, {
        provider: 'meta_lead_ads_live',
        sourceCode: 'meta_lead_ads',
        sourceName: 'Meta Lead Ads',
        allowMissingPhone: true,
        createFollowUpTask: options.createFollowUpTask ?? false,
        restoreArchivedMatches: Boolean(options.since),
      });
      for (const record of leadRecords) {
        await linkMetaLeadAttribution(record);
      }
      mergeSummary(summary, imported);
      records += leadRecords.length;
      formSummaries.push({
        formId,
        formName,
        status: text(form.status, 120),
        records: leadRecords.length,
      });
    } catch (error) {
      failedForms += 1;
      logger.error('Meta Lead Ads form sync failed', { pageId: config.pageId, formId, formName, error });
    }
  }

  return {
    forms: formSummaries.length,
    failedForms,
    records,
    summary,
    formSummaries,
  };
};

export const syncRecentMetaLeadAds = async (lookbackHours = 24) => {
  const config = metaLeadAdsConfig();
  if (!config.accessToken || !config.pageId) {
    return { skipped: true, forms: 0, failedForms: 0, records: 0, summary: emptySummary(), formSummaries: [] };
  }
  const boundedLookbackHours = Math.max(1, Math.min(Math.floor(lookbackHours), 168));
  const since = new Date(Date.now() - boundedLookbackHours * 60 * 60 * 1_000);
  return {
    skipped: false,
    ...(await importHistoricalMetaLeadAds({ since, createFollowUpTask: true })),
  };
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
    mergeSummary(summary, await importMetaLeadValue(value, true));
  }

  return { processed: values.length, summary };
};
