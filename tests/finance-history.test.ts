import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { closeEmployeeSalaryAccrual } from '../server/services/finance-history';

describe('salary history cutoff before employee deletion', () => {
  it('retains a separate academy calendar cutoff for future rates and closes only valid effective date intervals', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await closeEmployeeSalaryAccrual({ query }, 7);
    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0];
    expect(values).toEqual([7, 'Asia/Tashkent']);
    expect(sql).toContain('employment_ended_on = cutoff.ended_on');
    expect(sql).toContain('CASE WHEN sr.effective_from <= cutoff.ended_on');
    expect(sql).toContain('COALESCE(archived_at, NOW() AT TIME ZONE');
    expect(sql).not.toContain('DELETE');
  });

  it('adds a nullable cutoff without discarding or guessing legacy deleted salary history', () => {
    const migration = fs.readFileSync(new URL('../migrations/0130_preserve_salary_accrual_cutoff.sql', import.meta.url), 'utf8');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "employment_ended_on" date');
    expect(migration).not.toMatch(/DELETE FROM|UPDATE|DROP TABLE|NOT NULL/);
  });
});
