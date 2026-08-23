import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0093_add_employee_archive.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../server/db/schema/index.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0093 employee archive migration', () => {
  it('adds reversible archive state without deleting employee history', () => {
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL');
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "archived_at" timestamp');
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "archived_by" integer');
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "archived_previous_is_active" boolean');
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "archived_previous_online_pbx_incoming_enabled" boolean');
    expect(compactSql).toContain('REFERENCES "public"."users"("id") ON DELETE set null');
    expect(compactSql).toContain('CREATE INDEX IF NOT EXISTS "users_archive_idx"');
  });

  it('keeps the persistence schema aligned with the migration', () => {
    const usersSchema = schema.slice(schema.indexOf('export const users'), schema.indexOf('export const telephonyManagedExtensions'));
    expect(usersSchema).toContain('isArchived: boolean("is_archived").notNull().default(false)');
    expect(usersSchema).toContain('archivedPreviousIsActive: boolean("archived_previous_is_active")');
    expect(usersSchema).toContain('archiveIdx: index("users_archive_idx")');
  });

  it('is registered once immediately after the group archive migration', () => {
    expect(journal.entries.find((entry) => entry.idx === 92)?.tag).toBe('0092_add_group_archive');
    expect(journal.entries.find((entry) => entry.idx === 93)?.tag).toBe('0093_add_employee_archive');
    expect(journal.entries.filter((entry) => entry.idx === 93)).toHaveLength(1);
  });
});
