import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0087_merge_cyberpark_room_117.sql', import.meta.url),
  'utf8',
);

const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

describe('0087 Cyberpark room 117 merge migration', () => {
  it('moves every room foreign key before deleting the duplicate room', () => {
    const groupUpdate = migration.indexOf('UPDATE academy_groups');
    const lessonUpdate = migration.indexOf('UPDATE academy_lessons');
    const demoUpdate = migration.indexOf('UPDATE academy_demo_lessons');
    const sourceDelete = migration.indexOf('DELETE FROM academy_rooms');

    expect(groupUpdate).toBeGreaterThan(-1);
    expect(lessonUpdate).toBeGreaterThan(groupUpdate);
    expect(demoUpdate).toBeGreaterThan(lessonUpdate);
    expect(sourceDelete).toBeGreaterThan(demoUpdate);
  });

  it('locks related tables and rejects ambiguous source or target rooms', () => {
    expect(migration).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(migration).toContain('IF source_room_count <> 1');
    expect(migration).toContain('IF target_room_count <> 1');
    expect(migration).toContain('still has dependent records after reassignment');
  });

  it('is registered once as migration 0087', () => {
    expect(journal.entries
      .filter(({ tag }) => tag === '0087_merge_cyberpark_room_117')
      .map(({ idx, tag }) => ({ idx, tag })))
      .toEqual([{ idx: 87, tag: '0087_merge_cyberpark_room_117' }]);
  });
});
