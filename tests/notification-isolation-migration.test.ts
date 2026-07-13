import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0045_isolate_owned_notifications.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0045 owned notification isolation migration', () => {
  it('backfills the task owner before deleting notifications owned by somebody else', () => {
    expect(compactSql).toContain('task."responsible_id"');
    expect(compactSql).toContain('existing."user_id" = source_notification."responsible_id"');
    expect(compactSql).toContain('notification."user_id" IS DISTINCT FROM task."responsible_id"');
    expect(compactSql.indexOf('INSERT INTO "notifications"')).toBeLessThan(
      compactSql.indexOf('DELETE FROM "notifications"'),
    );
  });

  it('does not copy escalation notifications to administration workspaces', () => {
    expect(compactSql).not.toContain('user_workspaces');
    expect(compactSql).not.toContain("workspace = 'administration'");
  });

  it('realigns task, lead, and student notifications with their current owners', () => {
    expect(compactSql).toContain('notification."related_entity_type" = \'academy_task\'');
    expect(compactSql).toContain('notification."related_entity_type" = \'lead\'');
    expect(compactSql).toContain('notification."related_entity_type" = \'student\'');
    expect(compactSql).toContain('SET "user_id" = task."responsible_id", "is_read" = false');
    expect(compactSql).toContain('SET "user_id" = lead."manager_id", "is_read" = false');
    expect(compactSql).toContain('SET "user_id" = student."manager_id", "is_read" = false');
  });

  it('is registered once immediately after migration 0044', () => {
    expect(journal.entries.find((entry) => entry.idx === 44)?.tag).toBe('0044_materialize_group_lessons');
    expect(journal.entries.find((entry) => entry.idx === 45)?.tag).toBe('0045_isolate_owned_notifications');
    expect(journal.entries.filter((entry) => entry.idx === 45)).toHaveLength(1);
  });
});
