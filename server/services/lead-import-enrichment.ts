import type { PoolClient } from 'pg';
import { normalizeLeadImportPhone, type LeadImportFields } from './lead-import-fields';

type LeadRow = Omit<LeadImportFields, 'phoneNumbers'> & { phone: string | null; language: string | null };
type ImportLeadState = { row: LeadRow; indexedPhones: string[] };

export const storeImportedPhones = async (client: PoolClient, leadId: number, phones: string[]) => {
  for (const phone of phones) {
    await client.query(
      `INSERT INTO academy_lead_phones (lead_id, phone, normalized_phone, is_primary)
       VALUES ($1, $2, $2,
         NOT EXISTS (SELECT 1 FROM academy_lead_phones existing WHERE existing.lead_id = $1))
       ON CONFLICT (lead_id, normalized_phone) DO NOTHING`,
      [leadId, phone],
    );
  }
};

/** Fill empty fields only. Lock the contact before deciding which answers it represents. */
export const enrichLeadImportFields = async (
  client: PoolClient,
  leadId: number,
  incoming: LeadImportFields,
  apply = true,
  previous?: ImportLeadState,
) => {
  const result = previous ? { rows: [previous.row] } : await client.query<LeadRow>(
    `SELECT contact_name AS "contactName", phone, student_name AS "studentName", student_age AS "studentAge",
       locality, language, languages, study_days AS "studyDays", study_time AS "studyTime", goal, urgency
     FROM academy_leads WHERE id = $1${apply ? ' FOR UPDATE' : ''}`,
    [leadId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Imported lead ${leadId} no longer exists`);
  const phoneResult = previous ? { rows: previous.indexedPhones.map(phone => ({ phone })) } : await client.query<{ phone: string }>(
    'SELECT normalized_phone AS phone FROM academy_lead_phones WHERE lead_id = $1 ORDER BY is_primary DESC, id',
    [leadId],
  );
  const indexedPhones = phoneResult.rows.map(value => value.phone);
  const legacyPhone = normalizeLeadImportPhone(row.phone);
  const current: LeadImportFields = {
    contactName: row.contactName, studentName: row.studentName, studentAge: row.studentAge,
    locality: row.locality, studyDays: row.studyDays, studyTime: row.studyTime, goal: row.goal, urgency: row.urgency,
    languages: row.languages?.length ? row.languages : (row.language?.trim() ? [row.language] : []),
    phoneNumbers: [...new Set([...(legacyPhone ? [legacyPhone] : []), ...indexedPhones])],
  };
  const stored: LeadImportFields = { ...current, phoneNumbers: [...new Set([...current.phoneNumbers, ...incoming.phoneNumbers])] };
  const empty = (value: unknown) => value === null || value === undefined || value === '' || (typeof value === 'string' && !value.trim());
  if (empty(current.contactName) || /^Новый контакт(?:\s+\+?\d+)?$/u.test(current.contactName ?? '')) {
    stored.contactName = incoming.contactName ?? current.contactName;
  }
  for (const key of ['studentName', 'locality', 'studyDays', 'studyTime', 'goal', 'urgency'] as const) {
    if (empty(current[key])) stored[key] = incoming[key];
  }
  if (current.studentAge === null) stored.studentAge = incoming.studentAge;
  if (!current.languages.length) stored.languages = incoming.languages;
  const phone = empty(row.phone) ? stored.phoneNumbers[0] ?? null : row.phone;
  const fieldsChanged = phone !== row.phone || Object.keys(stored).some(key => key !== 'phoneNumbers'
    && JSON.stringify(stored[key as keyof LeadImportFields]) !== JSON.stringify(current[key as keyof LeadImportFields]));
  const missingPhones = stored.phoneNumbers.filter(value => !indexedPhones.includes(value));
  if (apply) {
    if (fieldsChanged) await client.query(
      `UPDATE academy_leads SET contact_name = $2, phone = $3, student_name = $4, student_age = $5,
         locality = $6, language = $7, languages = $8::text[], study_days = $9, study_time = $10,
         goal = $11, urgency = $12, updated_at = NOW() WHERE id = $1`,
      [leadId, stored.contactName, phone, stored.studentName, stored.studentAge, stored.locality,
        row.language?.trim() || stored.languages[0] || '', stored.languages, stored.studyDays, stored.studyTime, stored.goal, stored.urgency],
    );
    await storeImportedPhones(client, leadId, missingPhones);
  }
  const state: ImportLeadState = {
    row: { ...stored, phone, language: row.language?.trim() || stored.languages[0] || '' },
    indexedPhones: stored.phoneNumbers,
  };
  return { stored, state, changed: fieldsChanged || missingPhones.length > 0 };
};
