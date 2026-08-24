import { academyToday } from '@/lib/localeFormat';

export type ReportingDatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'previousMonth' | 'custom';

const REPORTING_PRESET_KEYS: readonly Exclude<ReportingDatePreset, 'custom'>[] = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'previousMonth'];

export const isReportingPresetKey = (value: unknown): value is Exclude<ReportingDatePreset, 'custom'> => (
  typeof value === 'string' && (REPORTING_PRESET_KEYS as readonly string[]).includes(value)
);

export type ReportingDateRange = {
  from: string;
  to: string;
  preset: ReportingDatePreset;
};

const dateOnlyFromParts = ({ year, month, day }: { year: number; month: number; day: number }) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export const reportingToday = academyToday;

export const addReportingDays = (dateOnly: string, days: number) => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return dateOnlyFromParts({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  });
};

const monthStart = (dateOnly: string, monthOffset = 0) => {
  const [year, month] = dateOnly.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  return dateOnlyFromParts({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: 1,
  });
};

export const reportingRangeForPreset = (
  preset: Exclude<ReportingDatePreset, 'custom'> = 'today',
  today = reportingToday(),
): ReportingDateRange => {
  if (preset === 'today') {
    return { from: today, to: today, preset };
  }
  if (preset === 'yesterday') {
    const yesterday = addReportingDays(today, -1);
    return { from: yesterday, to: yesterday, preset };
  }
  if (preset === 'last7') {
    return { from: addReportingDays(today, -6), to: today, preset };
  }
  if (preset === 'last30') {
    return { from: addReportingDays(today, -29), to: today, preset };
  }
  if (preset === 'previousMonth') {
    const from = monthStart(today, -1);
    return { from, to: addReportingDays(monthStart(today), -1), preset };
  }
  return { from: monthStart(today), to: today, preset: 'thisMonth' };
};

export const reportingRangeQuery = (range: Pick<ReportingDateRange, 'from' | 'to'>) => {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  return params.toString();
};

export const isInReportingRange = (
  value: string | Date | null | undefined,
  range: Pick<ReportingDateRange, 'from' | 'to'>,
) => {
  if (!value) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed >= range.from && trimmed <= range.to;
    }
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const from = new Date(`${range.from}T00:00:00+05:00`).getTime();
  const to = new Date(`${range.to}T23:59:59.999+05:00`).getTime();
  return timestamp >= from && timestamp <= to;
};
