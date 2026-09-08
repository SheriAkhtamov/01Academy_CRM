import { kpiMonthSchema } from '@shared/sales-kpi';
import { nextKpiMonth } from '@shared/sales-kpi-time';
import { addReportingDays, isReportingPresetKey, reportingRangeForPreset, reportingToday, type ReportingDateRange } from '@/lib/reportingDateRange';

// Match the inclusive limit accepted by the sales metrics endpoint.
export const MAX_SALES_REPORTING_DAYS = 731;

const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function salesRangeError(range: { from: unknown; to: unknown }): 'invalid' | 'tooLong' | null {
  if (!validDate(range.from) || !validDate(range.to) || range.from > range.to) return 'invalid';
  return (Date.parse(range.to) - Date.parse(range.from)) / 86400000 >= MAX_SALES_REPORTING_DAYS ? 'tooLong' : null;
}

export function salesMonthRange(month: string, today = reportingToday()): ReportingDateRange {
  return { from: `${month}-01`, to: month === today.slice(0, 7) ? today : addReportingDays(`${nextKpiMonth(month)}-01`, -1), preset: 'custom' };
}

/** Presets follow today's academy date; explicit dates survive navigation. */
export function resolveSalesReportingRange(stored: unknown, legacyMonth: unknown, today = reportingToday()): ReportingDateRange {
  if (stored && typeof stored === 'object' && 'preset' in stored) {
    if (isReportingPresetKey(stored.preset)) return reportingRangeForPreset(stored.preset, today);
    if (stored.preset === 'custom' && 'from' in stored && 'to' in stored && !salesRangeError({ from: stored.from, to: stored.to })) {
      return { from: stored.from as string, to: stored.to as string, preset: 'custom' };
    }
  }
  if (typeof legacyMonth === 'string' && kpiMonthSchema.safeParse(legacyMonth).success && legacyMonth < today.slice(0, 7)) {
    return salesMonthRange(legacyMonth, today);
  }
  return reportingRangeForPreset('thisMonth', today);
}

/** The monthly plan stays monthly and follows the report's final month. */
export function salesPlanMonth(range: Pick<ReportingDateRange, 'to'>, today = reportingToday()): string {
  const month = range.to.slice(0, 7);
  return month < '2000-01' ? '2000-01' : month > today.slice(0, 7) ? today.slice(0, 7) : month;
}
