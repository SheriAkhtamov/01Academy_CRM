import { describe, expect, it } from 'vitest';
import { buildMonthlyRevenueData } from '../client/src/lib/dashboardCharts';

describe('dashboard revenue chart logic', () => {
  it('shows the latest six payment months in chronological order for descending API data', () => {
    const payments = Array.from({ length: 8 }, (_, index) => ({
      paidAt: new Date(Date.UTC(2026, 7 - index, 15, 12)).toISOString(),
      createdAt: new Date(Date.UTC(2026, 7 - index, 10, 12)).toISOString(),
      amountUzs: String((8 - index) * 100),
    }));

    const result = buildMonthlyRevenueData(payments, 'en-US');

    expect(result).toEqual([
      { month: 'Mar 26', amount: 300 },
      { month: 'Apr 26', amount: 400 },
      { month: 'May 26', amount: 500 },
      { month: 'Jun 26', amount: 600 },
      { month: 'Jul 26', amount: 700 },
      { month: 'Aug 26', amount: 800 },
    ]);
  });

  it('aggregates payments by month and prefers paidAt over createdAt', () => {
    const result = buildMonthlyRevenueData([
      { paidAt: '2026-04-10T12:00:00Z', createdAt: '2026-03-31T12:00:00Z', amountUzs: 150 },
      { paidAt: '2026-04-20T12:00:00Z', amountUzs: '250' },
    ], 'en-US');

    expect(result).toEqual([{ month: 'Apr 26', amount: 400 }]);
  });

  it('ignores invalid dates and amounts instead of corrupting the chart', () => {
    const result = buildMonthlyRevenueData([
      { paidAt: 'not-a-date', amountUzs: 100 },
      { paidAt: '2026-05-01T12:00:00Z', amountUzs: 'not-a-number' },
      { paidAt: '2026-05-02T12:00:00Z', amountUzs: 500 },
    ], 'en-US');

    expect(result).toEqual([{ month: 'May 26', amount: 500 }]);
  });

  it('groups month boundaries in the academy timezone rather than the browser timezone', () => {
    const result = buildMonthlyRevenueData([
      { paidAt: '2026-07-31T18:59:59.999Z', amountUzs: 100 },
      { paidAt: '2026-07-31T19:00:00.000Z', amountUzs: 200 },
    ], 'en-US');

    expect(result).toEqual([
      { month: 'Jul 26', amount: 100 },
      { month: 'Aug 26', amount: 200 },
    ]);
  });

  it('does not count pending or refunded obligations as revenue', () => {
    const result = buildMonthlyRevenueData([
      { paidAt: '2026-07-10T12:00:00Z', amountUzs: 500, status: 'paid' },
      { createdAt: '2026-07-11T12:00:00Z', amountUzs: 700, status: 'pending' },
      { paidAt: '2026-07-12T12:00:00Z', amountUzs: 900, status: 'refunded' },
    ], 'en-US');

    expect(result).toEqual([{ month: 'Jul 26', amount: 500 }]);
  });
});
