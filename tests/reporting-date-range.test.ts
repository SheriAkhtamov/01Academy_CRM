import { describe, expect, it } from 'vitest';
import {
  isInReportingRange,
  reportingRangeForPreset,
  reportingRangeQuery,
} from '../client/src/lib/reportingDateRange';

describe('shared reporting date range', () => {
  it('builds stable quick periods from an explicit academy date', () => {
    expect(reportingRangeForPreset('today', '2026-07-26')).toEqual({
      from: '2026-07-26',
      to: '2026-07-26',
      preset: 'today',
    });
    expect(reportingRangeForPreset('last7', '2026-07-26')).toEqual({
      from: '2026-07-20',
      to: '2026-07-26',
      preset: 'last7',
    });
    expect(reportingRangeForPreset('thisMonth', '2026-07-26')).toEqual({
      from: '2026-07-01',
      to: '2026-07-26',
      preset: 'thisMonth',
    });
    expect(reportingRangeForPreset('previousMonth', '2026-07-26')).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      preset: 'previousMonth',
    });
  });

  it('treats both selected Tashkent calendar boundaries as inclusive', () => {
    const range = { from: '2026-07-01', to: '2026-07-24' };
    expect(isInReportingRange('2026-06-30T18:59:59.999Z', range)).toBe(false);
    expect(isInReportingRange('2026-06-30T19:00:00.000Z', range)).toBe(true);
    expect(isInReportingRange('2026-07-24T18:59:59.999Z', range)).toBe(true);
    expect(isInReportingRange('2026-07-24T19:00:00.000Z', range)).toBe(false);
  });

  it('serializes only explicit boundaries for API cache keys', () => {
    expect(reportingRangeQuery({ from: '2026-07-01', to: '2026-07-26' }))
      .toBe('from=2026-07-01&to=2026-07-26');
  });
});
