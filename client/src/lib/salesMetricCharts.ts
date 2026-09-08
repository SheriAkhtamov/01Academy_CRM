import { academyDateInputValue } from '@/lib/localeFormat';
import { addReportingDays } from '@/lib/reportingDateRange';

export type SalesSeriesPoint = { date: string; value: number };
export type SalesDatedValue = { date: string | null | undefined; value: number };

/** Dense daily buckets use the same academy calendar as the headline totals. */
export function buildSalesDailySeries(events: readonly SalesDatedValue[], range: { from: string; to: string }): SalesSeriesPoint[] {
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000;
  if (!Number.isInteger(days) || days < 0 || days > 366) return [];
  const totals = new Map<string, number>();
  for (let offset = 0; offset <= days; offset++) totals.set(addReportingDays(range.from, offset), 0);
  for (const event of events) {
    if (!Number.isFinite(event.value)) continue;
    const day = academyDateInputValue(event.date);
    const current = totals.get(day);
    if (current !== undefined) totals.set(day, current + event.value);
  }
  return Array.from(totals, ([date, value]) => ({ date, value }));
}

/** Missing measurements remain missing; only the drawing is clamped to its scale. */
export function salesGaugePosition(value: number | null, min = 0, max = 100): number | null {
  if (value === null || !Number.isFinite(value) || max <= min) return null;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function salesTargetCompletion(value: number | null, target: number | null): number | null {
  if (value === null || target === null || !Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return null;
  return Math.max(0, value / target * 100);
}
