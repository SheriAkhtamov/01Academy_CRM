import type { Pool } from 'pg';
import { publishRealtimeEvent } from '../realtime/realtime-hub';
import type { LeadImportRecord } from './lead-import';
import { buildLeadImportComment, buildLegacyLeadImportComment } from './lead-import-comments';
import { enrichLeadImportFields } from './lead-import-enrichment';
import { resolveLeadImportFields } from './lead-import-fields';

const replaceGeneratedParagraph = (comment: string | null, before: string, after: string): string | null => {
  if (!comment) return comment;
  if (comment === before) return after || null;
  // Replace only a complete, uniquely occurring generated paragraph.
  const padded = `\n\n${comment}\n\n`;
  const needle = `\n\n${before}\n\n`;
  const index = padded.indexOf(needle);
  if (index < 0 || padded.indexOf(needle, index + 1) >= 0) return comment;
  const replacement = after ? `\n\n${after}\n\n` : '\n\n';
  return (padded.slice(0, index) + replacement + padded.slice(index + needle.length)).slice(2, -2) || null;
};

/** Repair explicitly selected contacts from retained submissions; default is read-only. */
export const repairMetaLeadFields = async (pool: Pool, leadIds: number[], apply = false) => {
  if (!leadIds.length || leadIds.length > 1_000 || leadIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Provide 1–1000 positive lead IDs for Meta field repair');
  }
  const client = await pool.connect();
  const changedLeads = new Set<number>();
  const planned = new Map<number, Awaited<ReturnType<typeof enrichLeadImportFields>>['state']>();
  const handledComments = new Set<number>();
  let commentsChanged = 0;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    if (apply) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['meta-lead-field-repair']);
    const { rows } = await client.query<{ leadId: number; payload: LeadImportRecord }>(
      `SELECT record.lead_id AS "leadId", record.payload
       FROM academy_lead_import_records record JOIN academy_leads lead ON lead.id = record.lead_id
       WHERE record.provider IN ('meta_lead_ads', 'meta_lead_ads_live')
         AND record.outcome IN ('created', 'merged', 'merged_archived') AND record.lead_id = ANY($1::int[])
       ORDER BY record.lead_id, record.imported_at, record.id`,
      [leadIds],
    );
    for (const { leadId, payload } of rows) {
      if (!payload || typeof payload !== 'object' || payload.test === true) continue;
      const { stored, changed, state } = await enrichLeadImportFields(client, leadId, resolveLeadImportFields(payload), apply, planned.get(leadId));
      planned.set(leadId, state);
      if (changed) changedLeads.add(leadId);
      const before = buildLegacyLeadImportComment(payload);
      const after = buildLeadImportComment(payload, stored);
      const createdAt = payload.createdTime ? new Date(payload.createdTime) : null;
      if (!before || before === after || !createdAt || Number.isNaN(createdAt.getTime())) continue;
      const comments = await client.query<{ id: number }>(
        `SELECT id FROM academy_lead_comments
         WHERE lead_id = $1 AND author_id IS NULL AND body = $2 AND created_at = $3${apply ? ' FOR UPDATE' : ''}`,
        [leadId, before, createdAt],
      );
      // Ambiguous origins, edited comments and operator comments are deliberately retained.
      if (comments.rows.length !== 1 || handledComments.has(comments.rows[0].id)) continue;
      handledComments.add(comments.rows[0].id);
      commentsChanged += 1;
      changedLeads.add(leadId);
      if (!apply) continue;
      if (after) await client.query('UPDATE academy_lead_comments SET body = $2 WHERE id = $1', [comments.rows[0].id, after]);
      else await client.query('DELETE FROM academy_lead_comments WHERE id = $1', [comments.rows[0].id]);
      const lead = await client.query<{ comment: string | null }>('SELECT comment FROM academy_leads WHERE id = $1 FOR UPDATE', [leadId]);
      const current = lead.rows[0]?.comment ?? null;
      const next = replaceGeneratedParagraph(current, before, after);
      if (next !== current) await client.query('UPDATE academy_leads SET comment = $2, updated_at = NOW() WHERE id = $1', [leadId, next]);
    }
    await client.query('COMMIT');
    if (apply && changedLeads.size) publishRealtimeEvent({ type: 'ACADEMY_LEAD_UPDATED', data: { count: changedLeads.size } });
    return { apply, submissions: rows.length, leadsChanged: changedLeads.size, commentsChanged };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
