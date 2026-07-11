import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0043_enforce_attendance_integrity.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0043 attendance integrity migration', () => {
  it('audits and normalizes legacy values before adding the status constraint', () => {
    const auditPosition = compactSql.indexOf('INSERT INTO "audit_logs"');
    const updatePosition = compactSql.indexOf('UPDATE "academy_attendance"');
    const constraintPosition = compactSql.indexOf('ADD CONSTRAINT "academy_attendance_status_check"');

    expect(compactSql).toContain('LOCK TABLE "academy_attendance" IN SHARE ROW EXCLUSIVE MODE');
    expect(compactSql).toContain("'academy_attendance_legacy_status_normalized'");
    expect(compactSql).toContain("jsonb_build_object('status', attendance.\"status\")");
    expect(compactSql).toContain("LOWER(BTRIM(attendance.\"status\")) = 'present'");
    expect(compactSql).toContain("ELSE 'absent'");
    expect(compactSql).toContain("'unknown_legacy_status_defaulted_absent'");
    expect(compactSql).toContain("WHERE attendance.\"status\" NOT IN ('present', 'absent')");
    expect(auditPosition).toBeGreaterThanOrEqual(0);
    expect(updatePosition).toBeGreaterThan(auditPosition);
    expect(constraintPosition).toBeGreaterThan(updatePosition);
  });

  it('enforces the same attendance status domain in SQL and Drizzle', () => {
    expect(compactSql).toContain(
      'CHECK ("status" IN (\'present\', \'absent\'))',
    );
    expect(schema).toContain('statusCheck: check(');
    expect(schema).toContain('"academy_attendance_status_check"');
    expect(schema).toContain("sql`${table.status} IN ('present', 'absent')`");
  });

  it('adds both supporting indexes in SQL and Drizzle', () => {
    expect(compactSql).toContain(
      'CREATE INDEX "academy_attendance_student_idx" ON "academy_attendance" USING btree ("student_id")',
    );
    expect(compactSql).toContain(
      'CREATE INDEX "academy_lesson_reschedules_changed_by_idx" ON "academy_lesson_reschedules" USING btree ("changed_by")',
    );
    expect(schema).toContain('studentIdx: index("academy_attendance_student_idx").on(table.studentId)');
    expect(schema).toContain('changedByIdx: index("academy_lesson_reschedules_changed_by_idx").on(table.changedBy)');
  });

  it('is registered once immediately after migration 0042', () => {
    expect(journal.entries.find((entry) => entry.idx === 42)?.tag).toBe('0042_enforce_unique_student_leads');
    expect(journal.entries.find((entry) => entry.idx === 43)?.tag).toBe('0043_enforce_attendance_integrity');
    expect(journal.entries.filter((entry) => entry.idx === 43)).toHaveLength(1);
  });
});
