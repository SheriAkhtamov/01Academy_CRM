import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../migrations/0122_archive_schools_and_rooms.sql', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'));

describe('school and room archive migration', () => {
  it('leaves existing schools and rooms outside the archive and preserves a separate activity snapshot', () => {
    expect(migration.match(/is_archived boolean NOT NULL DEFAULT false/g)).toHaveLength(2);
    expect(migration.match(/archived_previous_is_active boolean/g)).toHaveLength(2);
    expect(migration).not.toMatch(/UPDATE|DELETE FROM/);
    expect(migration.match(/CHECK \(NOT is_archived OR NOT is_active\)/g)).toHaveLength(2);
  });

  it('registers the migration once after the existing final migration', () => {
    const entries = journal.entries;
    expect(entries.filter((entry: { tag: string }) => entry.tag === '0122_archive_schools_and_rooms')).toHaveLength(1);
    const archiveIndex = entries.findIndex((entry: { tag: string }) => entry.tag === '0122_archive_schools_and_rooms');
    expect(entries[archiveIndex]).toMatchObject({ idx: 122, tag: '0122_archive_schools_and_rooms' });
    expect(entries[archiveIndex].when).toBeGreaterThan(entries[archiveIndex - 1].when);
  });
});
