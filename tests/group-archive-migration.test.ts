import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readAcademyModuleSource } from './helpers/read-academy-module';

const migration = readFileSync(
  new URL('../migrations/0092_add_group_archive.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../server/db/schema/index.ts', import.meta.url), 'utf8');
const routes = readAcademyModuleSource();
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0092 group archive migration', () => {
  it('gives a group a shelf of its own, separate from its lifecycle status', () => {
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL');
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "archived_at" timestamp');
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "archived_by" integer');
    expect(compactSql).toContain('REFERENCES "public"."users"("id") ON DELETE set null');
    expect(compactSql).toContain('CREATE INDEX IF NOT EXISTS "academy_groups_archive_idx"');
    expect(schema).toContain('isArchived: boolean("is_archived").notNull().default(false)');
    expect(schema).toContain('archiveIdx: index("academy_groups_archive_idx")');
  });

  it('keeps groups the administration screen already called archived on the shelf', () => {
    expect(compactSql).toContain('UPDATE "academy_groups"');
    expect(compactSql).toContain("WHERE \"status\" = 'completed'");
    expect(compactSql).toContain('AND "is_archived" = false');
  });

  it('hides an archived group from the schedules that show work in hand', () => {
    expect(routes).toContain('COALESCE(g.is_archived, false) AS group_is_archived');
    expect(routes).toContain('AND COALESCE(g.is_archived, false) = false');
  });

  it('lets only a group owner or administration move a group to the archive', () => {
    expect(routes).toContain("router.post('/groups/:id/archive'");
    expect(routes).toContain("router.post('/groups/:id/unarchive'");
    expect(routes).toContain("res.status(403).json({ error: 'teacherOwnGroupArchiveOnly' })");
    expect(routes).toContain("res.status(409).json({ error: 'onlyCompletedGroupsCanBeArchived' })");
    expect(routes).toContain("createAudit(req, 'ARCHIVE_ACADEMY_GROUP'");
    expect(routes).toContain("createAudit(req, 'UNARCHIVE_ACADEMY_GROUP'");
  });

  it('is registered once immediately after migration 0091', () => {
    expect(journal.entries.find((entry) => entry.idx === 91)?.tag).toBe('0091_remove_capacity_limits');
    expect(journal.entries.find((entry) => entry.idx === 92)?.tag).toBe('0092_add_group_archive');
    expect(journal.entries.filter((entry) => entry.idx === 92)).toHaveLength(1);
  });
});
