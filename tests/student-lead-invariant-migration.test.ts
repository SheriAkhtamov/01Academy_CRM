import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0042_enforce_unique_student_leads.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0042 unique student lead repair migration', () => {
  it('keeps a stable studying-first canonical student and only detaches duplicates', () => {
    expect(compactSql).toContain("CASE WHEN student.\"status\" = 'studying' THEN 0 ELSE 1 END");
    expect(compactSql).toContain('student."created_at" ASC NULLS LAST, student."id" ASC');
    expect(compactSql).toContain('WHERE ranked.duplicate_rank > 1');
    expect(compactSql).toContain("'academy_student_duplicate_lead_detached'");
    expect(compactSql).toContain('SET "lead_id" = NULL');
    expect(compactSql).not.toMatch(/DELETE FROM "academy_students"/i);
  });

  it('repairs lead tasks from the 0033 merge audit and closes only later open duplicates', () => {
    expect(compactSql).toContain("audit.\"action\" = 'instagram_lead_merged'");
    expect(compactSql).toContain("audit.\"old_values\" ->> 'duplicateLeadId'");
    expect(compactSql).toContain("audit.\"new_values\" ->> 'retainedLeadId'");
    expect(compactSql).toContain("task.\"entity_type\" = 'lead'");
    expect(compactSql).toContain('task."entity_id" = repair.duplicate_lead_id');
    expect(compactSql).toContain('task."entity_id", task."title", task."responsible_id"');
    expect(compactSql).toContain('WITH RECURSIVE raw_audits AS');
    expect(compactSql).toContain('lead_paths.visited_lead_ids || next_map.canonical_lead_id');
    expect(compactSql).toContain('task."description", task."deadline_at", task."status"');
    expect(compactSql).toContain('task."completed_at", task."escalated_at"');
    expect(compactSql).toContain("task.\"status\" <> 'done'");
    expect(compactSql).toContain('ORDER BY task."created_at" ASC NULLS LAST, task."id" ASC');
    expect(compactSql).toContain('SET "status" = \'done\'');
  });

  it('enforces the same partial unique index in SQL, Drizzle schema, and journal order', () => {
    expect(compactSql).toContain(
      'CREATE UNIQUE INDEX "academy_students_lead_unique" ON "academy_students" USING btree ("lead_id") WHERE "lead_id" IS NOT NULL',
    );
    expect(schema).toContain('uniqueIndex("academy_students_lead_unique")');
    expect(schema).toContain('.where(sql`${table.leadId} IS NOT NULL`)');

    const previous = journal.entries.find((entry) => entry.idx === 41);
    const current = journal.entries.find((entry) => entry.idx === 42);
    expect(previous?.tag).toBe('0041_add_referral_benefits');
    expect(current?.tag).toBe('0042_enforce_unique_student_leads');
    expect(journal.entries.filter((entry) => entry.idx === 42)).toHaveLength(1);
  });
});
