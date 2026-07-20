import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(repositoryRoot, 'migrations/0052_add_telephony_calls.sql');
const journalPath = path.join(repositoryRoot, 'migrations/meta/_journal.json');

describe('telephony calls migration', () => {
  it('registers the migration immediately after the OnlinePBX employee mapping', () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 51)?.tag)
      .toBe('0051_add_onlinepbx_extension');
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 52)?.tag)
      .toBe('0052_add_telephony_calls');
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 52)).toHaveLength(1);
  });

  it('creates durable call history and provider/client idempotency indexes', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "telephony_calls"');
    expect(migration).toContain('"client_call_id"');
    expect(migration).toContain('"provider_call_id"');
    expect(migration).toContain('telephony_calls_client_call_unique');
    expect(migration).toContain('telephony_calls_provider_call_unique');
  });
});
