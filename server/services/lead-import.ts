import { enqueueMetaLeadIntakeSafely } from './meta-marketing';
import type { Pool, PoolClient } from 'pg';
import { publishRealtimeEvent } from '../realtime/realtime-hub';
import { resolveLeadFunnelId } from './lead-funnels';

export type LeadImportRecord = {
  externalId: string;
  sheet?: string | null;
  row?: number | null;
  createdTime?: string | null;
  contactName?: string | null;
  phone?: string | null;
  rawPhone?: string | null;
  campaignName?: string | null;
  campaignId?: string | null;
  adsetName?: string | null;
  adsetId?: string | null;
  adName?: string | null;
  adId?: string | null;
  formName?: string | null;
  formId?: string | null;
  platform?: string | null;
  isOrganic?: boolean | null;
  childAgeAnswer?: string | number | null;
  cityAnswer?: string | null;
  offlineAnswer?: string | null;
  occupationAnswer?: string | null;
  note?: string | null;
  answers?: Array<{
    name: string;
    values: unknown[];
  }>;
  disclaimerResponses?: Array<{
    name: string;
    value: unknown;
  }>;
  test?: boolean;
  [key: string]: unknown;
};

export type LeadImportSummary = {
  created: number;
  merged: number;
  mergedArchived: number;
  skippedTest: number;
  skippedInvalid: number;
  alreadyImported: number;
};

type LeadImportOptions = {
  provider: string;
  sourceCode?: string;
  sourceName?: string;
  allowMissingPhone?: boolean;
  createFollowUpTask?: boolean;
  restoreArchivedMatches?: boolean;
};

const text = (value: unknown) => String(value ?? '').trim();

export const normalizeLeadImportPhone = (value: unknown): string | null => {
  const raw = text(value).replace(/^p:/i, '').trim();
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.startsWith('998') && digits.length !== 12) return null;
  return `+${digits}`;
};

const answerText = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return typeof value === 'string' || typeof value === 'number' ? text(value) : '';
};

const answerLabel = (value: unknown): string => {
  const name = text(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const key = name.toLowerCase();
  if (/^(external id|leadgen id|page id|campaign (id|name)|adset (id|name)|ad (id|name)|form (id|name)|created time|platform|is organic|source sheet|row|sheet)$/.test(key)) return '';
  const labels: Record<string, string> = {
    'full name': 'Имя', 'contact name': 'Имя', 'parent name': 'Имя',
    'first name': 'Имя', 'last name': 'Фамилия',
    phone: 'Телефон', 'phone number': 'Телефон', 'mobile phone': 'Телефон', 'mobile number': 'Телефон',
    email: 'Электронная почта', city: 'Город', 'child age': 'Возраст ребёнка',
    'learning format': 'Формат обучения', occupation: 'Сфера деятельности',
  };
  return labels[key] ?? name;
};

export const buildLeadImportComment = (record: LeadImportRecord) => {
  const lines: string[] = [];
  const addAnswer = (label: string, value: unknown) => {
    const normalized = answerText(value);
    const line = `${label}: ${normalized}`;
    if (label && normalized && !lines.includes(line)) lines.push(line);
  };
  for (const answer of Array.isArray(record.answers) ? record.answers : []) {
    const values = Array.isArray(answer?.values) ? answer.values.map(answerText).filter(Boolean) : [];
    addAnswer(answerLabel(answer?.name), values.join(', '));
  }
  const details: Array<[string, unknown]> = [
    ['Возраст ребёнка', record.childAgeAnswer],
    ['Город', record.cityAnswer],
    ['Формат обучения', record.offlineAnswer],
    ['Сфера деятельности', record.occupationAnswer],
    ['Заметка', record.note],
  ];
  for (const [label, value] of details) addAnswer(label, value);
  return lines.join('\n');
};

const importOutcome = async (
  client: PoolClient,
  provider: string,
  record: LeadImportRecord,
  outcome: 'created' | 'merged' | 'merged_archived' | 'skipped_test' | 'skipped_invalid',
  leadId: number | null,
) => {
  await client.query(
    `INSERT INTO academy_lead_import_records
       (provider, external_id, lead_id, source_sheet, outcome, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (provider, external_id) DO NOTHING`,
    [provider, text(record.externalId), leadId, text(record.sheet) || null, outcome, JSON.stringify(record)],
  );
};

const findLeadByPhone = async (client: PoolClient, phone: string) => {
  const digits = phone.replace(/\D/g, '');
  const result = await client.query<{
    id: number;
    isArchived: boolean;
  }>(
    `SELECT lead.id, COALESCE(lead.is_archived, false) AS "isArchived"
     FROM academy_leads lead
     WHERE EXISTS (
       SELECT 1
       FROM academy_lead_phones indexed_phone
       WHERE indexed_phone.lead_id = lead.id
         AND indexed_phone.normalized_phone = $1
     )
     OR regexp_replace(COALESCE(lead.phone, ''), '\\D', '', 'g') = $2
     OR EXISTS (
       SELECT 1
       FROM academy_students student
       WHERE student.lead_id = lead.id
         AND regexp_replace(COALESCE(student.phone, ''), '\\D', '', 'g') = $2
     )
     ORDER BY COALESCE(lead.is_archived, false), lead.updated_at DESC NULLS LAST, lead.id DESC
     LIMIT 1`,
    [phone, digits],
  );
  return result.rows[0] ?? null;
};

const restoreArchivedLead = async (
  client: PoolClient,
  leadId: number,
  enteredAt: Date,
) => {
  const restored = await client.query<{ from_status_code: string | null; to_status_code: string }>(
    `WITH archived_lead AS (
       SELECT id, status_code
       FROM academy_leads
       WHERE id = $1 AND is_archived = true
       FOR UPDATE
     ), restored_lead AS (
       UPDATE academy_leads lead
       SET status_code = (SELECT initial_stage_code FROM academy_sales_funnels WHERE id = lead.funnel_id),
           is_archived = false,
           archive_reason = NULL,
           archived_at = NULL,
           archived_by = NULL,
           first_viewed_at = NULL,
           updated_at = NOW()
       FROM archived_lead
       WHERE lead.id = archived_lead.id
       RETURNING archived_lead.status_code AS from_status_code, lead.status_code AS to_status_code
     )
     SELECT from_status_code, to_status_code FROM restored_lead`,
    [leadId],
  );
  const previousStatus = restored.rows[0]?.from_status_code;
  const nextStatus = restored.rows[0]?.to_status_code;
  if (previousStatus && nextStatus && previousStatus !== nextStatus) {
    await client.query(
      `INSERT INTO academy_lead_stage_history
       (lead_id, from_status_code, to_status_code, entered_at, comment)
       VALUES ($1, $2, $4, $3, 'Повторная заявка из Meta Instant Form')`,
      [leadId, previousStatus, enteredAt, nextStatus],
    );
  }
  return (restored.rowCount ?? 0) > 0;
};

export const importLeadRecords = async (
  pool: Pool,
  records: LeadImportRecord[],
  options: LeadImportOptions,
): Promise<LeadImportSummary> => {
  const provider = text(options.provider);
  if (!provider) throw new Error('Import provider is required');
  if (!Array.isArray(records)) throw new Error('Import payload must be an array');

  const createdLeadIds: number[] = [];
  let intakeCommitted = false;
  const summary: LeadImportSummary = {
    created: 0,
    merged: 0,
    mergedArchived: 0,
    skippedTest: 0,
    skippedInvalid: 0,
    alreadyImported: 0,
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lead-import:${provider}`]);
    const source = await client.query<{ id: number }>(
      `INSERT INTO academy_lead_sources
         (code, name, channel, is_system, is_active, updated_at)
       VALUES ($1, $2, 'instagram', true, true, NOW())
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           channel = EXCLUDED.channel,
           is_system = true,
           is_active = true,
           updated_at = NOW()
       RETURNING id`,
      [options.sourceCode ?? 'meta_lead_ads', options.sourceName ?? 'Meta Lead Ads'],
    );
    const sourceId = source.rows[0].id;
    const funnelId = await resolveLeadFunnelId(client, 'meta');

    for (const record of records) {
      const externalId = text(record.externalId) || `${text(record.sheet) || 'sheet'}:${record.row ?? 'unknown'}`;
      const normalizedRecord = { ...record, externalId };
      const existingImport = await client.query<{
        id: number;
        lead_id: number | null;
        outcome: string;
      }>(
        `SELECT id, lead_id, outcome FROM academy_lead_import_records
         WHERE provider = $1 AND external_id = $2
         LIMIT 1`,
        [provider, externalId],
      );
      if (existingImport.rowCount) {
        const existing = existingImport.rows[0];
        if (
          options.restoreArchivedMatches
          && existing.outcome === 'merged_archived'
          && Number.isSafeInteger(existing.lead_id)
          && Number(existing.lead_id) > 0
        ) {
          const restored = await restoreArchivedLead(client, Number(existing.lead_id), new Date());
          await client.query(
            `UPDATE academy_lead_import_records SET outcome = 'merged' WHERE id = $1`,
            [existing.id],
          );
          if (restored) summary.mergedArchived += 1;
        }
        summary.alreadyImported += 1;
        continue;
      }
      if (record.test === true || /<test lead:/i.test(JSON.stringify(record))) {
        await importOutcome(client, provider, normalizedRecord, 'skipped_test', null);
        summary.skippedTest += 1;
        continue;
      }

      const phone = normalizeLeadImportPhone(record.rawPhone ?? record.phone);
      if (!phone && !options.allowMissingPhone) {
        await importOutcome(client, provider, normalizedRecord, 'skipped_invalid', null);
        summary.skippedInvalid += 1;
        continue;
      }

      const comment = buildLeadImportComment(normalizedRecord);
      const commentCreatedAt = record.createdTime && !Number.isNaN(new Date(record.createdTime).getTime())
        ? new Date(record.createdTime)
        : new Date();
      let matchedLead = phone ? await findLeadByPhone(client, phone) : null;
      let outcome: 'created' | 'merged' | 'merged_archived';
      if (!matchedLead) {
        const contactName = text(record.contactName)
          || (phone ? `Новый контакт ${phone}` : 'Новый контакт');
        const created = await client.query<{ id: number }>(
          `INSERT INTO academy_leads (
             contact_name, phone, source_id, funnel_id, advertising_campaign, status_code,
             language, languages, comment, first_contact_channel, created_at, updated_at
          )
           VALUES ($1, $2, $3, $4, $5, (SELECT initial_stage_code FROM academy_sales_funnels WHERE id = $4), '', ARRAY[]::text[], $6, 'instagram', $7, NOW())
           RETURNING id`,
          [contactName, phone, sourceId, funnelId, text(record.campaignName) || null, comment || null, commentCreatedAt],
        );
        matchedLead = { id: created.rows[0].id, isArchived: false };
        await client.query(
          `INSERT INTO academy_lead_stage_history
           (lead_id, from_status_code, to_status_code, entered_at)
           VALUES ($1, NULL, (SELECT status_code FROM academy_leads WHERE id = $1), $2)`,
          [matchedLead.id, commentCreatedAt],
        );
        outcome = 'created';
        createdLeadIds.push(Number(matchedLead.id));
        summary.created += 1;
      } else {
        if (matchedLead.isArchived && options.restoreArchivedMatches) {
          await restoreArchivedLead(client, matchedLead.id, commentCreatedAt);
        }
        await client.query(
          `UPDATE academy_leads
           SET comment = CASE
                 WHEN NULLIF(BTRIM($2::text), '') IS NULL THEN comment
                 WHEN NULLIF(BTRIM(comment), '') IS NULL THEN $2
                 WHEN POSITION($2 IN comment) > 0 THEN comment
                 ELSE comment || E'\\n\\n' || $2
               END,
               advertising_campaign = COALESCE(NULLIF(BTRIM(advertising_campaign), ''), $3),
               updated_at = NOW()
           WHERE id = $1`,
          [matchedLead.id, comment, text(record.campaignName) || null],
        );
        if (matchedLead.isArchived) {
          outcome = 'merged_archived';
          summary.mergedArchived += 1;
        } else {
          outcome = 'merged';
          summary.merged += 1;
        }
      }

      if (options.createFollowUpTask) {
        await client.query(
          `INSERT INTO academy_tasks
             (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
           SELECT
             'Первый контакт по заявке Meta',
             'Связаться с лидом из Instant Form в течение 15 минут.',
             lead.manager_id,
             NOW() + INTERVAL '15 minutes',
             'lead',
             $1,
             'new'
            FROM academy_leads lead WHERE lead.id = $1 AND lead.manager_id IS NOT NULL`,
          [matchedLead.id],
        );
      }

      if (comment) await client.query(
        `INSERT INTO academy_lead_comments (lead_id, author_id, body, created_at)
         VALUES ($1, NULL, $2, $3)`,
        [matchedLead.id, comment, commentCreatedAt],
      );
      if (phone) {
        await client.query(
          `INSERT INTO academy_lead_phones
             (lead_id, phone, normalized_phone, is_primary)
           VALUES (
             $1, $2, $2,
             NOT EXISTS (SELECT 1 FROM academy_lead_phones existing WHERE existing.lead_id = $1)
           )
           ON CONFLICT (lead_id, normalized_phone) DO NOTHING`,
          [matchedLead.id, phone],
        );
        await client.query(
          `UPDATE academy_leads
           SET phone = COALESCE(NULLIF(BTRIM(phone), ''), $2)
           WHERE id = $1`,
          [matchedLead.id, phone],
        );
      }
      const recordedOutcome = outcome === 'merged_archived' && options.restoreArchivedMatches
        ? 'merged'
        : outcome;
      await importOutcome(client, provider, normalizedRecord, recordedOutcome, matchedLead.id);
    }

    await client.query('COMMIT');
    intakeCommitted = true;
    if (summary.created > 0) {
      publishRealtimeEvent({ type: 'ACADEMY_LEAD_CREATED', data: { count: summary.created } });
    }
    if (summary.merged > 0 || summary.mergedArchived > 0) {
      publishRealtimeEvent({
        type: 'ACADEMY_LEAD_UPDATED',
        data: { count: summary.merged + summary.mergedArchived },
      });
    }
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    if (intakeCommitted) for (const leadId of createdLeadIds) await enqueueMetaLeadIntakeSafely(leadId);
  }
};
