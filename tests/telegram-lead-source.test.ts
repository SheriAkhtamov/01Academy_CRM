import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0102_restore_telegram_lead_source.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const leadSheet = readFileSync(
  new URL('../client/src/components/ux/LeadDetailSheet.tsx', import.meta.url),
  'utf8',
);

describe('Telegram lead source', () => {
  it('restores Telegram as an active protected source without creating duplicates', () => {
    expect(migration).toContain("VALUES ('telegram', 'Telegram', 'telegram', true, true, NOW())");
    expect(migration).toContain('ON CONFLICT ("code") DO UPDATE');
    expect(migration).toContain('"is_system" = true');
    expect(migration).toContain('"is_active" = true');
    expect(journal.entries.find((entry) => entry.idx === 102)?.tag)
      .toBe('0102_restore_telegram_lead_source');
  });

  it('renders active server-provided sources in the existing lead modal select', () => {
    expect(leadSheet).toContain('{sources.map((source) => (');
    expect(leadSheet).toContain('<SelectItem key={source.id} value={String(source.id)}>');
  });
});
