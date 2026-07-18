import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0050_add_lead_group_reservations.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../server/routes/academy.routes.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0050 lead group reservations migration', () => {
  it('normalizes lead group selections with foreign keys and a unique pair', () => {
    expect(compactSql).toContain('CREATE TABLE "academy_lead_group_reservations"');
    expect(compactSql).toContain('FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id")');
    expect(compactSql).toContain('FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id")');
    expect(compactSql).toContain('CREATE UNIQUE INDEX "academy_lead_group_reservations_lead_group_unique"');
    expect(schema).toContain('academyLeadGroupReservations');
    expect(schema).toContain('uniqueIndex("academy_lead_group_reservations_lead_group_unique")');
  });

  it('backfills the legacy group only for leads that are not students yet', () => {
    expect(compactSql).toContain('lead."enrolled_group_id" IS NOT NULL');
    expect(compactSql).toContain('FROM "academy_students" student');
    expect(compactSql).toContain('student."lead_id" = lead."id"');
    expect(compactSql).toContain('ON CONFLICT ("lead_id", "group_id") DO NOTHING');
  });

  it('moves every selected lead group into student memberships after payment', () => {
    expect(routes).toContain('FROM UNNEST($5::int[]) AS selected_group_id');
    expect(routes).toContain('selected_group_id = $2');
    expect(routes).toContain('DELETE FROM academy_lead_group_reservations WHERE lead_id = $1');
  });

  it('is registered once immediately after migration 0049', () => {
    expect(journal.entries.find((entry) => entry.idx === 49)?.tag).toBe('0049_add_student_group_enrollments');
    expect(journal.entries.find((entry) => entry.idx === 50)?.tag).toBe('0050_add_lead_group_reservations');
    expect(journal.entries.filter((entry) => entry.idx === 50)).toHaveLength(1);
  });
});
