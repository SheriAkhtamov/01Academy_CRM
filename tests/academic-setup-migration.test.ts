import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compact = (sql: string) => sql.replace(/\s+/g, ' ');
const contract = compact(read('migrations/0173_lead_outcomes_contract.sql'));
const setup = compact(read('migrations/0174_academic_setup.sql'));
const setupContract = compact(read('migrations/0175_academic_setup_contract.sql'));
const schema = read('server/db/schema/index.ts');
const journal = JSON.parse(read('migrations/meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe('stage 3 migrations', () => {
  it('follow stage 2 in the journal with increasing timestamps', () => {
    const start = journal.entries.findIndex((entry) => entry.tag === '0173_lead_outcomes_contract');
    expect(journal.entries.slice(start, start + 3).map((entry) => [entry.idx, entry.tag]))
      .toEqual([[173, '0173_lead_outcomes_contract'], [174, '0174_academic_setup'], [175, '0175_academic_setup_contract']]);
    const times = journal.entries.map((entry) => entry.when);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });

  it('drop what the stage 2 release stopped using and keep won deals apart from lost ones', () => {
    expect(contract).toContain('DROP TABLE IF EXISTS "academy_lead_funnel_qualifications"');
    expect(contract).toContain('DROP TABLE IF EXISTS "academy_lead_group_reservations"');
    expect(contract).toContain('DROP COLUMN IF EXISTS "enrolled_group_id"');
    expect(contract).toContain('CHECK (NOT ("is_won" AND "is_archived"))');
    expect(schema).not.toContain('academy_lead_funnel_qualifications');
    expect(schema).not.toContain('enrolled_group_id');
  });

  it('give branches and courses unique short codes, ONL staying reserved for online groups', () => {
    for (const table of ['academy_schools', 'academy_courses']) {
      expect(setup).toContain(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "short_code" varchar(10)`);
      expect(setup).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}_short_code_unique"`);
    }
    expect(setup).toContain(`"short_code" <> 'ONL'`);
    // Codes the previous generator approved come first, so existing names stay consistent.
    expect(setup.indexOf("state.saved->'schoolCodes'")).toBeLessThan(setup.indexOf("lower(code) IN ('cyberpark', 'cyp')"));
  });

  it('number groups from a sequence that starts after every number already given out', () => {
    expect(setup).toContain('CREATE SEQUENCE IF NOT EXISTS "academy_group_code_seq" AS integer MINVALUE 1');
    expect(setup).toContain("WHERE audit.entity_type IN ('academy_group', 'academy_groups')");
    expect(setup).toContain("new_values::jsonb->>'highWaterNumber'");
    expect(setup).toContain("SELECT setval('academy_group_code_seq'");
  });

  it('let online groups go without a branch or a room and give lessons their own note', () => {
    expect(setup).toContain(`ADD COLUMN IF NOT EXISTS "delivery_mode" varchar(20) DEFAULT 'offline' NOT NULL`);
    expect(setup).toContain(`ALTER TABLE "academy_groups" ALTER COLUMN "school_id" DROP NOT NULL`);
    expect(setup).toContain(`CHECK ("delivery_mode" = 'online' OR "school_id" IS NOT NULL)`);
    expect(setup).toContain(`CHECK ("status" = 'planned' OR "delivery_mode" = 'online' OR "room_id" IS NOT NULL)`);
    expect(setup).toContain(`ALTER TABLE "academy_lessons" ALTER COLUMN "room_id" DROP NOT NULL`);
    expect(setup).toContain(`ALTER TABLE "academy_lessons" ADD COLUMN IF NOT EXISTS "note" text`);
    // Only a note every mark of a lesson carries becomes the lesson's note; the copies stay for a rollback.
    expect(setup).toContain(`HAVING bool_and(btrim(COALESCE(note, '')) <> '') AND count(DISTINCT btrim(note)) = 1`);
    expect(setup).not.toMatch(/UPDATE "academy_attendance"/);
  });

  it('then take rooms from online groups and lesson-note copies from the marks', () => {
    // Only lessons still to come leave the room; conducted ones keep where they took place.
    expect(setupContract).toContain(`AND academy_group.delivery_mode = 'online' AND lesson.status = 'scheduled'`);
    expect(setupContract).toContain(`UPDATE "academy_groups" SET "room_id" = NULL WHERE "delivery_mode" = 'online'`);
    expect(setupContract).toContain(`CHECK ("delivery_mode" <> 'online' OR "room_id" IS NULL)`);
    expect(schema).toContain('academy_groups_online_without_room');
    expect(setupContract).toContain('AND btrim(mark.note) = btrim(lesson.note)');
    // No revision changes: an unchanged mark must not look like a new absence.
    expect(setupContract).not.toContain('updated_at');
  });
});
