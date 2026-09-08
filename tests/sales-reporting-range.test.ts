import { describe, expect, it } from 'vitest';
import { resolveSalesReportingRange, salesPlanMonth, salesRangeError } from '../client/src/lib/salesReportingRange';

describe('sales reporting period preferences', () => {
  const today = '2026-09-08';
  it('restores explicit dates and refreshes a relative preset after the academy date changes', () => {
    const custom = { from: '2025-12-15', to: '2026-08-19', preset: 'custom' };
    expect(resolveSalesReportingRange(custom, '2026-07', today)).toEqual(custom);
    expect(resolveSalesReportingRange({ from: '2026-08-01', to: '2026-08-05', preset: 'thisMonth' }, null, today))
      .toEqual({ from: '2026-09-01', to: today, preset: 'thisMonth' });
    expect(resolveSalesReportingRange({ preset: 'previousMonth' }, null, '2024-03-01'))
      .toEqual({ from: '2024-02-01', to: '2024-02-29', preset: 'previousMonth' });
  });

  it('migrates the old month preference and safely replaces corrupt saved dates', () => {
    expect(resolveSalesReportingRange(null, '2024-02', today)).toEqual({ from: '2024-02-01', to: '2024-02-29', preset: 'custom' });
    for (const stored of [null, [], 'bad', { preset: 'unknown' }, { preset: 'custom', from: '2026-02-29', to: today }, { preset: 'custom', from: today, to: '2026-01-01' }, { preset: 'custom', from: '2020-01-01', to: today }]) {
      expect(resolveSalesReportingRange(stored, 'invalid', today)).toEqual({ from: '2026-09-01', to: today, preset: 'thisMonth' });
    }
    expect(salesRangeError({ from: '2024-02-29', to: '2024-02-29' })).toBeNull();
  });

  it('uses the last report month for monthly plans without requesting a future month', () => {
    expect(salesPlanMonth({ to: '2026-08-15' }, today)).toBe('2026-08');
    expect(salesPlanMonth({ to: '2026-12-31' }, today)).toBe('2026-09');
    expect(salesPlanMonth({ to: '1999-12-31' }, today)).toBe('2000-01');
  });
});
