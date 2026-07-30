import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0072_add_missed_call_read_state.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

describe('missed call read-state migration', () => {
  it('creates one durable notification cursor per employee', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "telephony_missed_call_states"');
    expect(migration).toContain('"user_id" integer PRIMARY KEY');
    expect(migration).toContain('"last_seen_call_id" integer NOT NULL DEFAULT 0');
    expect(migration).toContain('ON DELETE CASCADE');
  });

  it('treats existing calls as already viewed during rollout', () => {
    expect(migration).toContain('SELECT MAX("telephony_calls"."id") FROM "telephony_calls"');
    expect(migration).toContain('FROM "users"');
    expect(migration).toContain('ON CONFLICT ("user_id") DO NOTHING');
  });

  it('initializes the cursor when a new employee is created', () => {
    expect(migration).toContain('FUNCTION "initialize_telephony_missed_call_state"');
    expect(migration).toContain('AFTER INSERT ON "users"');
    expect(migration).toContain('EXECUTE FUNCTION "initialize_telephony_missed_call_state"');
  });

  it('registers migration 0072 once after the session-store migration', () => {
    expect(journal.entries.find((entry) => entry.idx === 71)?.tag)
      .toBe('0071_add_session_store');
    expect(journal.entries.find((entry) => entry.idx === 72)?.tag)
      .toBe('0072_add_missed_call_read_state');
    expect(journal.entries.filter((entry) => entry.idx === 72)).toHaveLength(1);
  });
});
