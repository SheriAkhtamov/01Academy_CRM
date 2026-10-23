import { describe, expect, it } from 'vitest';
import { fillSalesReportDays } from '../server/modules/academy/sales-report-series';
import { salesReportChartPoints } from '../client/src/features/sales/report-charts';
import { salesReportUnitKey } from '../client/src/features/sales/report-labels';

describe('sales report chart values', () => {
  it('fills missing dates with measured zeroes, including a leap day', () => {
    const daily = fillSalesReportDays(undefined, { from: '2024-02-28', to: '2024-03-01' });
    daily[2].newLeads = 5;
    const filled = fillSalesReportDays([daily[2]], { from: '2024-02-28', to: '2024-03-01' });
    expect(filled.map(day => [day.date, day.newLeads])).toEqual([
      ['2024-02-28', 0], ['2024-02-29', 0], ['2024-03-01', 5],
    ]);
  });
  it('groups a year without losing counts or the first and last date', () => {
    const daily = fillSalesReportDays(undefined, { from: '2024-01-01', to: '2024-12-31' });
    daily.forEach((day, i) => { day.reachedLeads = i % 7; });
    const expected = daily.reduce((total, day) => total + day.reachedLeads, 0);
    const points = salesReportChartPoints(daily, 'reachedLeads');
    expect(points.length).toBeLessThanOrEqual(40);
    expect(points[0].from).toBe('2024-01-01');
    expect(points.at(-1)?.to).toBe('2024-12-31');
    expect(points.reduce((total, point) => total + point.value, 0)).toBe(expected);
    expect(salesReportChartPoints(daily, 'reachedLeads', true).at(-1)?.value).toBe(expected);
  });
  it('keeps an empty or single-day interval truthful', () => {
    expect(salesReportChartPoints([], 'newLeads')).toEqual([]);
    const daily = fillSalesReportDays(undefined, { from: '2026-08-01', to: '2026-08-01' });
    expect(salesReportChartPoints(daily, 'newLeads')).toEqual([{ from: '2026-08-01', to: '2026-08-01', value: 0 }]);
    daily[0].newLeads = 12;
    expect(salesReportChartPoints(daily, 'newLeads', true)[0].value).toBe(12);
  });
  it('uses singular and plural units for the selected language', () => {
    expect(salesReportUnitKey('leads', 1, 'ru')).toBe('leadCountOne');
    expect(salesReportUnitKey('leads', 2, 'ru')).toBe('leadCountFew');
    expect(salesReportUnitKey('leads', 11, 'ru')).toBe('leadCountMany');
    expect(salesReportUnitKey('leads', 21, 'en')).toBe('leadCountMany');
    expect(salesReportUnitKey('students', 21, 'ru')).toBe('salesReportStudentOne');
  });
});
