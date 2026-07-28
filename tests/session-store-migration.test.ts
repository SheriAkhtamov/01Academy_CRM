import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0071_add_session_store.sql', import.meta.url),
  'utf8',
);
const sessionInfrastructure = readFileSync(
  new URL('../server/infrastructure/session.ts', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

describe('session store migration', () => {
  it('creates the PostgreSQL session store through the migration pipeline', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "session"');
    expect(migration).toContain('CONSTRAINT "session_pkey" PRIMARY KEY ("sid")');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "IDX_session_expire"');
  });

  it('disables hidden schema creation during application startup', () => {
    expect(sessionInfrastructure).toContain('createTableIfMissing: false');
    expect(sessionInfrastructure).not.toContain('createTableIfMissing: true');
  });

  it('registers the session store migration after migration 0070', () => {
    expect(journal.entries.find((entry) => entry.idx === 70)?.tag)
      .toBe('0070_reset_onlinepbx_assignments');
    expect(journal.entries.find((entry) => entry.idx === 71)?.tag)
      .toBe('0071_add_session_store');
    expect(journal.entries.filter((entry) => entry.idx === 71)).toHaveLength(1);
  });
});
