import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0112_capture_scheduled_kpi_trials.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

describe('scheduled KPI trial capture migration', () => {
  it('captures a post-tracking demo while clamping a pre-tracking invitation', () => {
    expect(migration).toContain('demo.scheduled_at >= tracked.tracked_at');
    expect(migration).toContain('GREATEST(NEW.created_at, tracked.tracked_at)');
    expect(migration).toContain('GREATEST(participant.created_at, tracked.tracked_at)');
    expect(migration).toContain('ON CONFLICT (participant_id) DO NOTHING');
  });

  it('leaves demos entirely before the tracking boundary excluded', () => {
    expect(migration).toContain('scheduled_at < tracked.tracked_at');
    expect(migration).toContain('participant.created_at < tracked.tracked_at');
  });

  it('registers the migration after the salary variants', () => {
    const entryIndex = journal.entries.findIndex((entry) => (
      entry.tag === '0112_capture_scheduled_kpi_trials'
    ));
    expect(journal.entries[entryIndex]).toEqual({
      idx: 112,
      tag: '0112_capture_scheduled_kpi_trials',
      version: '7',
      when: 1789920000009,
      breakpoints: true,
    });
    expect(journal.entries[entryIndex - 1]?.tag).toBe('0111_full_cycle_salary_variants');
  });
});
