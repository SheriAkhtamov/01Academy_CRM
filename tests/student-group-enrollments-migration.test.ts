import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0049_add_student_group_enrollments.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0049 student group enrollments migration', () => {
  it('backfills the legacy primary group without losing enrollment dates', () => {
    expect(compactSql).toContain('INSERT INTO "academy_student_group_enrollments"');
    expect(compactSql).toContain('MAX(transfer."created_at")');
    expect(compactSql).toContain('student."enrolled_at"');
    expect(compactSql).toContain('student."enrollment_date"');
    expect(compactSql).toContain('WHERE student."group_id" IS NOT NULL');
    expect(compactSql).toContain('ON CONFLICT ("student_id", "group_id") WHERE "status" = \'active\' DO NOTHING');
  });

  it('enforces one active membership per group and one active primary group', () => {
    expect(compactSql).toContain('CREATE UNIQUE INDEX "academy_student_group_enrollments_active_unique"');
    expect(compactSql).toContain('WHERE "status" = \'active\'');
    expect(compactSql).toContain('CREATE UNIQUE INDEX "academy_student_group_enrollments_active_primary_unique"');
    expect(compactSql).toContain('AND "is_primary" = true');
    expect(schema).toContain('academyStudentGroupEnrollments');
    expect(schema).toContain('uniqueIndex("academy_student_group_enrollments_active_unique")');
    expect(schema).toContain('uniqueIndex("academy_student_group_enrollments_active_primary_unique")');
  });

  it('allows family phones across leads while keeping each lead phone list unique', () => {
    expect(compactSql).toContain('DROP INDEX IF EXISTS "academy_lead_phones_normalized_unique"');
    expect(compactSql).toContain('CREATE UNIQUE INDEX "academy_lead_phones_lead_normalized_unique"');
    expect(compactSql).toContain('("lead_id", "normalized_phone")');
    expect(compactSql).toContain('CREATE INDEX "academy_lead_phones_normalized_idx"');
    expect(schema).toContain('uniqueIndex("academy_lead_phones_lead_normalized_unique")');
    expect(schema).toContain('index("academy_lead_phones_normalized_idx")');
  });

  it('is registered once immediately after migration 0048', () => {
    expect(journal.entries.find((entry) => entry.idx === 48)?.tag).toBe('0048_clean_instagram_lead_names');
    expect(journal.entries.find((entry) => entry.idx === 49)?.tag).toBe('0049_add_student_group_enrollments');
    expect(journal.entries.filter((entry) => entry.idx === 49)).toHaveLength(1);
  });
});
