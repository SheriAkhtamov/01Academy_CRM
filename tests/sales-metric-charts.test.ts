import { describe, expect, it } from 'vitest';
import { buildSalesDailySeries, salesGaugePosition, salesTargetCompletion } from '../client/src/lib/salesMetricCharts';

describe('sales indicator data', () => {
  it('buckets timestamps at Tashkent midnight, adds duplicate days, and retains days without events', () => {
    const points = buildSalesDailySeries([
      { date: '2026-07-31T18:59:59Z', value: 900 },
      { date: '2026-07-31T19:00:00Z', value: 100 },
      { date: '2026-08-01', value: 50 },
      { date: '2026-08-03T18:59:59Z', value: 25 },
      { date: '2026-08-03T19:00:00Z', value: 700 },
      { date: 'invalid', value: 123 },
      { date: null, value: 123 },
      { date: '2026-08-02', value: NaN },
    ], { from: '2026-08-01', to: '2026-08-03' });
    expect(points).toEqual([{ date: '2026-08-01', value: 150 }, { date: '2026-08-02', value: 0 }, { date: '2026-08-03', value: 25 }]);
  });

  it('supports a first-day report, leap days, and empty or invalid ranges', () => {
    expect(buildSalesDailySeries([], { from: '2026-09-01', to: '2026-09-01' })).toEqual([{ date: '2026-09-01', value: 0 }]);
    expect(buildSalesDailySeries([], { from: '2028-02-28', to: '2028-03-01' }).map((point) => point.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(buildSalesDailySeries([], { from: '2026-09-02', to: '2026-09-01' })).toEqual([]);
    expect(buildSalesDailySeries([], { from: '', to: '' })).toEqual([]);
  });

  it('keeps missing, zero, over-target, and negative NPS measurements distinct', () => {
    expect(salesGaugePosition(null)).toBeNull();
    expect(salesGaugePosition(NaN)).toBeNull();
    expect(salesGaugePosition(0)).toBe(0);
    expect(salesGaugePosition(90)).toBe(0.9);
    expect(salesGaugePosition(-40, -100, 100)).toBe(0.3);
    expect(salesGaugePosition(130)).toBe(1);
    expect(salesTargetCompletion(39, 30)).toBe(130);
    expect(salesTargetCompletion(null, 30)).toBeNull();
    expect(salesTargetCompletion(0, 30)).toBe(0);
    expect(salesTargetCompletion(10, 0)).toBeNull();
  });

  it('retains revenue across years for the full supported 731-day interval', () => {
    const range = { from: '2024-01-01', to: '2025-12-31' };
    const points = buildSalesDailySeries([
      { date: '2023-12-31T19:00:00Z', value: 100 },
      { date: '2024-02-29', value: 50 },
      { date: '2025-12-31T18:59:59Z', value: 25 },
      { date: '2025-12-31T19:00:00Z', value: 700 },
    ], range);
    expect(points).toHaveLength(731);
    expect(points.reduce((total, point) => total + point.value, 0)).toBe(175);
    expect(points.at(-1)).toEqual({ date: '2025-12-31', value: 25 });
    expect(buildSalesDailySeries([], { ...range, to: '2026-01-01' })).toEqual([]);
    expect(buildSalesDailySeries([], { from: '2025-02-29', to: '2025-03-01' })).toEqual([]);
  });
});
