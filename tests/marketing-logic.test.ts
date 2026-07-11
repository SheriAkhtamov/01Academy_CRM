import { describe, expect, it } from 'vitest';
import { expenseOverlapsMonth, funnelForSource, leadToPaidConversion } from '../client/src/lib/marketingLogic';

describe('marketing client logic', () => {
  it('includes expenses whose period overlaps the selected month', () => {
    expect(expenseOverlapsMonth({ periodStart: '2026-01-20', periodEnd: '2026-03-05' }, '2026-02')).toBe(true);
    expect(expenseOverlapsMonth({ periodStart: '2026-03-01', periodEnd: '2026-03-31' }, '2026-02')).toBe(false);
    expect(expenseOverlapsMonth({ createdAt: '2026-02-14T12:00:00Z' }, '2026-02')).toBe(true);
  });

  it('recalculates funnel counts for a source instead of reusing global counts', () => {
    const funnel = [{ code: 'new_request', count: 10 }, { code: 'paid', count: 5 }];
    const leads = [
      { sourceId: 1, statusCode: 'new_request' },
      { sourceId: 1, statusCode: 'paid' },
      { sourceId: 2, statusCode: 'paid' },
    ];
    expect(funnelForSource(funnel, leads, '1').map((stage) => stage.count)).toEqual([2, 1]);
    expect(funnelForSource(funnel, leads, 'all').map((stage) => stage.count)).toEqual([3, 2]);
  });

  it('derives lead-to-paid conversion from the data supplied to the workspace', () => {
    expect(leadToPaidConversion([{ statusCode: 'paid' }, { statusCode: 'new_request' }])).toBe(50);
    expect(leadToPaidConversion([])).toBe(0);
  });
});
