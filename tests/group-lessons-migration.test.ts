import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0044_materialize_group_lessons.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0044 group lesson materialization migration', () => {
  it('creates concrete lessons for active groups without touching groups that already have lessons', () => {
    expect(compactSql).toContain("academy_group.\"status\" IN ('open', 'in_progress')");
    expect(compactSql).toContain('NOT EXISTS ( SELECT 1 FROM "academy_lessons" AS existing_lesson');
    expect(compactSql).toContain("EXTRACT(ISODOW FROM parsed_schedule.generated_start_date + day_offset.value)");
    expect(compactSql).toContain("AT TIME ZONE 'Asia/Tashkent'");
    expect(compactSql).toContain('numbered_lesson.generated_lesson_number <= numbered_lesson."lesson_count"');
    expect(compactSql).toContain('INSERT INTO "academy_lessons"');
    expect(compactSql).toContain("'academy_group_lessons_materialized'");
  });

  it('uses the earliest enrollment as the legacy fallback and derives the group end date', () => {
    expect(compactSql).toContain('MIN(COALESCE(student."enrolled_at", student."created_at"))');
    expect(compactSql).toContain('academy_group."created_at"');
    expect(compactSql).toContain('MAX(backfill.scheduled_at)::date::timestamp AS generated_end_date');
  });

  it('normalizes legacy lesson numbers and enforces one number per group', () => {
    expect(compactSql).toContain("'academy_lesson_number_normalized'");
    expect(compactSql).toContain('PARTITION BY lesson."group_id" ORDER BY lesson."scheduled_at", lesson."id"');
    expect(compactSql).toContain(
      'CREATE UNIQUE INDEX "academy_lessons_group_lesson_number_unique" ON "academy_lessons" USING btree ("group_id", "lesson_number")',
    );
    expect(schema).toContain('uniqueIndex("academy_lessons_group_lesson_number_unique")');
    expect(schema).toContain('.on(table.groupId, table.lessonNumber)');
  });

  it('is registered once immediately after migration 0043', () => {
    expect(journal.entries.find((entry) => entry.idx === 43)?.tag).toBe('0043_enforce_attendance_integrity');
    expect(journal.entries.find((entry) => entry.idx === 44)?.tag).toBe('0044_materialize_group_lessons');
    expect(journal.entries.filter((entry) => entry.idx === 44)).toHaveLength(1);
  });
});
