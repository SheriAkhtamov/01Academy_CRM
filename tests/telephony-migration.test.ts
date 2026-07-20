import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(repositoryRoot, 'migrations/0052_add_telephony_calls.sql');
const reconciliationPath = path.join(repositoryRoot, 'migrations/0053_reconcile_telephony_calls.sql');
const journalMigrationPath = path.join(repositoryRoot, 'migrations/0054_add_call_journal_and_lead_channels.sql');
const journalPath = path.join(repositoryRoot, 'migrations/meta/_journal.json');

describe('telephony calls migration', () => {
  it('registers the migration immediately after the OnlinePBX employee mapping', () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 51)?.tag)
      .toBe('0051_add_onlinepbx_extension');
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 52)?.tag)
      .toBe('0052_add_telephony_calls');
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 52)).toHaveLength(1);
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 53)?.tag)
      .toBe('0053_reconcile_telephony_calls');
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 53)).toHaveLength(1);
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 54)?.tag)
      .toBe('0054_add_call_journal_and_lead_channels');
    expect(journal.entries.filter((entry: { idx: number }) => entry.idx === 54)).toHaveLength(1);
  });

  it('links calls to leads and adds the durable multi-channel identity model', () => {
    const migration = fs.readFileSync(journalMigrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "academy_lead_channels"');
    expect(migration).toContain('academy_lead_channels_external_unique');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "lead_id" integer');
    expect(migration).toContain('telephony_calls_lead_started_idx');
    expect(migration).toContain("('telephony', 'Телефония', 'call'");
  });

  it('creates durable call history and provider/client idempotency indexes', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "telephony_calls"');
    expect(migration).toContain('"client_call_id"');
    expect(migration).toContain('"provider_call_id"');
    expect(migration).toContain('telephony_calls_client_call_unique');
    expect(migration).toContain('telephony_calls_provider_call_unique');
  });

  it('merges a provider webhook row into its matching browser call', () => {
    const reconciliation = fs.readFileSync(reconciliationPath, 'utf8');

    expect(reconciliation).toContain('provider_row.provider_call_id = client_row.client_call_id');
    expect(reconciliation).toContain('SET provider_call_id = NULL');
    expect(reconciliation).toContain('DELETE FROM telephony_calls');
  });
});
