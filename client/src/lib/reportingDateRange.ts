import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';

export type ReportingDatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'previousMonth' | 'custom';

export type ReportingDateRange = {
  from: string;
  to: string;
  preset: ReportingDatePreset;
};

const REPORTING_TIME_ZONE = ACADEMY_TIME_ZONE;

const datePartsInTimeZone = (value: Date, timeZone = REPORTING_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
};

const dateOnlyFromParts = ({ year, month, day }: { year: number; month: number; day: number }) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export const reportingToday = () => dateOnlyFromParts(datePartsInTimeZone(new Date()));

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
