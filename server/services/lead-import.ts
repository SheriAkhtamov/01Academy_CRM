import type { Pool, PoolClient } from 'pg';

export type LeadImportRecord = {
  externalId: string;
  sheet?: string | null;
  row?: number | null;
  createdTime?: string | null;
  contactName?: string | null;
  phone?: string | null;
  rawPhone?: string | null;
  campaignName?: string | null;
  formName?: string | null;
  platform?: string | null;
  childAgeAnswer?: string | number | null;
  cityAnswer?: string | null;
  offlineAnswer?: string | null;
  occupationAnswer?: string | null;
  note?: string | null;
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

export const buildLeadImportComment = (
  record: LeadImportRecord,
  providerLabel = 'Meta Lead Ads',
) => {
  const externalId = text(record.externalId);
  const lines = [`[Импорт ${providerLabel} · ${text(record.sheet) || 'лист без названия'} · #${externalId}]`];
  const details: Array<[string, unknown]> = [
    ['Дата заявки', record.createdTime],
    ['Кампания', record.campaignName],
    ['Форма', record.formName],
    ['Возраст ребёнка', record.childAgeAnswer],
    ['Город', record.cityAnswer],
    ['Формат обучения', record.offlineAnswer],
    ['Сфера деятельности', record.occupationAnswer],
    ['Заметка', record.note],
  ];
  for (const [label, value] of details) {
    const normalized = text(value).replace(/_/g, ' ');
    if (normalized) lines.push(`${label}: ${normalized}`);
  }
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

export const importLeadRecords = async (
  pool: Pool,
  records: LeadImportRecord[],
  options: {
    provider: string;
    providerLabel?: string;
    sourceCode?: string;
    sourceName?: string;
  },
): Promise<LeadImportSummary> => {
  const provider = text(options.provider);
  if (!provider) throw new Error('Import provider is required');
  if (!Array.isArray(records)) throw new Error('Import payload must be an array');

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

    for (const record of records) {
      const externalId = text(record.externalId) || `${text(record.sheet) || 'sheet'}:${record.row ?? 'unknown'}`;
      const normalizedRecord = { ...record, externalId };
      const existingImport = await client.query(
        `SELECT id FROM academy_lead_import_records
         WHERE provider = $1 AND external_id = $2
         LIMIT 1`,
        [provider, externalId],
      );
      if (existingImport.rowCount) {
        summary.alreadyImported += 1;
        continue;
      }
      if (record.test === true || /<test lead:/i.test(JSON.stringify(record))) {
        await importOutcome(client, provider, normalizedRecord, 'skipped_test', null);
        summary.skippedTest += 1;
        continue;
      }

      const phone = normalizeLeadImportPhone(record.rawPhone ?? record.phone);
      if (!phone) {
        await importOutcome(client, provider, normalizedRecord, 'skipped_invalid', null);
        summary.skippedInvalid += 1;
        continue;
      }

      const comment = buildLeadImportComment(normalizedRecord, options.providerLabel);
      let matchedLead = await findLeadByPhone(client, phone);
      let outcome: 'created' | 'merged' | 'merged_archived';
      if (!matchedLead) {
        const createdAt = record.createdTime && !Number.isNaN(new Date(record.createdTime).getTime())
          ? new Date(record.createdTime)
          : new Date();
        const contactName = text(record.contactName) || `Новый контакт ${phone}`;
        const created = await client.query<{ id: number }>(
          `INSERT INTO academy_leads (
             contact_name, phone, source_id, advertising_campaign, status_code,
             language, comment, first_contact_channel, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, 'new_request', 'ru', $5, 'instagram', $6, NOW())
           RETURNING id`,
          [contactName, phone, sourceId, text(record.campaignName) || null, comment, createdAt],
        );
        matchedLead = { id: created.rows[0].id, isArchived: false };
        await client.query(
          `INSERT INTO academy_lead_stage_history
             (lead_id, from_status_code, to_status_code, entered_at, comment)
           VALUES ($1, NULL, 'new_request', $2, $3)`,
          [matchedLead.id, createdAt, `Импортирован из ${options.providerLabel ?? 'Meta Lead Ads'}`],
        );
        outcome = 'created';
        summary.created += 1;
      } else {
        await client.query(
          `UPDATE academy_leads
           SET comment = CASE
                 WHEN COALESCE(comment, '') LIKE $2 THEN comment
                 WHEN NULLIF(BTRIM(comment), '') IS NULL THEN $3
                 ELSE comment || E'\\n\\n' || $3
               END,
               advertising_campaign = COALESCE(NULLIF(BTRIM(advertising_campaign), ''), $4),
               updated_at = NOW()
           WHERE id = $1`,
          [matchedLead.id, `%#${externalId}]%`, comment, text(record.campaignName) || null],
        );
        if (matchedLead.isArchived) {
          outcome = 'merged_archived';
          summary.mergedArchived += 1;
        } else {
          outcome = 'merged';
          summary.merged += 1;
        }
      }

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
      await importOutcome(client, provider, normalizedRecord, outcome, matchedLead.id);
    }

    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
