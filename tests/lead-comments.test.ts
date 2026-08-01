import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readAcademyModuleSource } from './helpers/read-academy-module';

const migration = readFileSync(
  new URL('../migrations/0063_add_lead_comment_history.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../server/db/schema/index.ts', import.meta.url), 'utf8');
const routes = readAcademyModuleSource();
const leadSheet = readFileSync(
  new URL('../client/src/components/ux/LeadDetailSheet.tsx', import.meta.url),
  'utf8',
);
const leadActivity = readFileSync(
  new URL('../client/src/features/leads/ui/LeadActivity.tsx', import.meta.url),
  'utf8',
);
const leadImport = readFileSync(
  new URL('../server/services/lead-import.ts', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('lead comment history', () => {
  it('stores immutable comment entries with lead and author relations', () => {
    expect(compactSql).toContain('CREATE TABLE IF NOT EXISTS "academy_lead_comments"');
    expect(compactSql).toContain('FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE cascade');
    expect(compactSql).toContain('FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null');
    expect(compactSql).toContain('CREATE INDEX IF NOT EXISTS "academy_lead_comments_lead_created_idx"');
    expect(schema).toContain('export const academyLeadComments');
    expect(schema).toContain('index("academy_lead_comments_lead_created_idx").on(table.leadId, table.createdAt)');
  });

  it('backfills the previous single lead comment without duplicating it', () => {
    expect(compactSql).toContain('INSERT INTO "academy_lead_comments"');
    expect(compactSql).toContain('BTRIM(lead."comment")');
    expect(compactSql).toContain('NULLIF(BTRIM(lead."comment"), \'\') IS NOT NULL');
    expect(compactSql).toContain('WHERE existing."lead_id" = lead."id"');
    expect(compactSql).toContain('existing."body" = BTRIM(lead."comment")');
  });

  it('serves, appends, merges, and imports comment history', () => {
    expect(routes).toContain("router.post('/leads/:id/comments'");
    expect(routes).toContain('ORDER BY comment.created_at DESC, comment.id DESC');
    expect(routes).toContain("await insertRow('academy_lead_comments'");
    expect(routes).toContain('UPDATE academy_lead_comments SET lead_id = $1 WHERE lead_id = $2');
    expect(leadImport).toContain('INSERT INTO academy_lead_comments (lead_id, author_id, body, created_at)');
  });

  it('uses a separate composer and includes comments in the activity timeline', () => {
    expect(leadSheet).toContain('composer={(');
    expect(leadSheet).toContain("t('addCommentPlaceholder')");
    expect(leadSheet).toContain('leadsApi.addComment(leadId!, { body })');
    expect(leadSheet).not.toContain("apiRequest('POST', `/api/academy/leads/${leadId}/comments`");
    expect(leadActivity).toContain('...(lead.comments ?? []).map((item): ActivityItem => ({');
    expect(leadActivity).toContain('dateTime(comment.createdAt)');
    expect(leadSheet).not.toContain('comment: lead.comment ??');
  });

  it('registers the migration once after the current latest migration', () => {
    expect(journal.entries.find((entry) => entry.idx === 62)?.tag).toBe('0062_configurable_onlinepbx_forwarding');
    expect(journal.entries.find((entry) => entry.idx === 63)?.tag).toBe('0063_add_lead_comment_history');
    expect(journal.entries.filter((entry) => entry.idx === 63)).toHaveLength(1);
  });
});
