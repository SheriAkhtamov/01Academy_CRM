import type { Pool } from 'pg';
import { leadImportSource } from './lead-import';

export const repairMetaLeadChannels = async (pool: Pool, apply = false) => {
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const { rows } = await client.query<{ id: number }>(
      `WITH origin AS (
         SELECT DISTINCT ON (lead_id) lead_id, LOWER(payload->>'platform') AS platform
         FROM academy_lead_import_records
         WHERE provider IN ('meta_lead_ads', 'meta_lead_ads_live') AND outcome = 'created'
         ORDER BY lead_id, imported_at, id
       )
       SELECT lead.id FROM academy_leads lead
       JOIN origin ON origin.lead_id = lead.id
       JOIN academy_lead_sources source ON source.id = lead.source_id
       WHERE origin.platform IN ('fb', 'facebook')
         AND lead.first_contact_channel = 'instagram' AND source.code = 'meta_lead_ads'`,
    );
    let updated = 0;
    if (apply && rows.length) {
      const source = leadImportSource('facebook');
      const result = await client.query<{ id: number }>(
        `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active)
         VALUES ($1, $2, $3, true, true)
         ON CONFLICT (code) DO UPDATE SET channel = EXCLUDED.channel, updated_at = NOW()
         RETURNING id`,
        [source.code, source.name, source.channel],
      );
      // Preserve a contact's original channel when a later Facebook submission
      // was merely merged into an existing Instagram/manual contact.
      const repaired = await client.query(
        `UPDATE academy_leads SET source_id = $1, first_contact_channel = 'facebook', updated_at = NOW()
         WHERE id = ANY($2::int[]) AND first_contact_channel = 'instagram'
           AND source_id = (SELECT id FROM academy_lead_sources WHERE code = 'meta_lead_ads')`,
        [result.rows[0].id, rows.map((row) => row.id)],
      );
      updated = repaired.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { apply, eligible: rows.length, updated };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
