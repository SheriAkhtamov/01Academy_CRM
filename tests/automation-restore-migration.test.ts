import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  repositoryRoot,
  'migrations/0060_restore_automatically_closed_leads.sql',
);
const journalPath = path.join(repositoryRoot, 'migrations/meta/_journal.json');

describe('automatic lead stage repair migration', () => {
  it('registers the restoration migration once', () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx === 60);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.tag).toBe('0060_restore_automatically_closed_leads');
  });

  it('restores only leads whose latest transition is the unsafe automation', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('DISTINCT ON (history."lead_id")');
    expect(migration).toContain('lead."status_code" = \'not_now\'');
    expect(migration).toContain(
      "latest.\"comment\" = 'Автоматический перенос: нет ответа 14+ дней'",
    );
    expect(migration).toContain('latest."from_status_code" AS "restore_status_code"');
    expect(migration).toContain('"status_code" = repair."restore_status_code"');
  });

  it('keeps an audit trail and closes artifacts created by the bad transition', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toContain("'Автоматическое восстановление: отменён ошибочный перенос по неактивности'");
    expect(migration).toContain("task.\"title\" = 'Лид автоматически перенесён в тёплую базу'");
    expect(migration).toContain('outbox."status" IN (\'pending\', \'processing\')');
    expect(migration).toContain("'restoredLeadCount', COUNT(*)");
  });
});
