import { describe, expect, it } from 'vitest';
import {
  buildAnalyticsTimeline,
  compactRankedSeries,
  percentage,
} from '../client/src/lib/analyticsCharts';

describe('analytics chart helpers', () => {
  it('aggregates academy-time events into inclusive daily buckets', () => {
    const timeline = buildAnalyticsTimeline([
      { at: '2026-07-19T19:00:00.000Z', series: 'leads' },
      { at: '2026-07-20T10:00:00.000Z', series: 'leads' },
      { at: '2026-07-21T18:59:59.999Z', series: 'revenue', value: 250 },
      { at: '2026-07-21T19:00:00.000Z', series: 'revenue', value: 999 },
    ], { from: '2026-07-20', to: '2026-07-21' }, 'en-US', ['leads', 'revenue']);

    expect(timeline).toEqual([
      { periodStart: '2026-07-20', label: 'Jul 20', leads: 2, revenue: 0 },
      { periodStart: '2026-07-21', label: 'Jul 21', leads: 0, revenue: 250 },
    ]);
  });

  it('uses stable percentage math for empty and populated cohorts', () => {
    expect(percentage(3, 4)).toBe(75);
    expect(percentage(1, 3, 1)).toBe(33.3);
    expect(percentage(4, 0)).toBe(0);
  });

  it('returns a non-mutating top category ranking', () => {
    const source = [{ value: 2 }, { value: 7 }, { value: 4 }];
    expect(compactRankedSeries(source, (row) => row.value, 2)).toEqual([{ value: 7 }, { value: 4 }]);
    expect(source).toEqual([{ value: 2 }, { value: 7 }, { value: 4 }]);
  });
});
