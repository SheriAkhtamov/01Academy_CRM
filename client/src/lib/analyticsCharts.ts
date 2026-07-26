import type { ReportingDateRange } from '@/lib/reportingDateRange';

export type AnalyticsTimelineEvent = {
  at: string | Date | null | undefined;
  series: string;
  value?: number;
};

export type AnalyticsTimelinePoint = {
  periodStart: string;
  label: string;
  [series: string]: string | number;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const ACADEMY_TIME_ZONE = 'Asia/Tashkent';

const academyDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACADEMY_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateOrdinal = (dateOnly: string) => Date.parse(`${dateOnly}T00:00:00Z`);

const academyDateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : academyDateFormatter.format(date);
};

export function buildAnalyticsTimeline(
  events: readonly AnalyticsTimelineEvent[],
  range: Pick<ReportingDateRange, 'from' | 'to'>,
  locale: string,
  seriesKeys: readonly string[],
): AnalyticsTimelinePoint[] {
  const fromOrdinal = dateOrdinal(range.from);
  const toOrdinal = dateOrdinal(range.to);
  if (!Number.isFinite(fromOrdinal) || !Number.isFinite(toOrdinal) || toOrdinal < fromOrdinal) return [];

  const totalDays = Math.round((toOrdinal - fromOrdinal) / DAY_MS) + 1;
  const stepDays = totalDays <= 14 ? 1 : totalDays <= 70 ? 7 : Math.ceil(totalDays / 12);
  const bucketCount = Math.ceil(totalDays / stepDays);
  const labelFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
  });
  const points = Array.from({ length: bucketCount }, (_, index) => {
    const bucketOrdinal = fromOrdinal + index * stepDays * DAY_MS;
    return {
      periodStart: new Date(bucketOrdinal).toISOString().slice(0, 10),
      label: labelFormatter.format(new Date(bucketOrdinal)),
      ...Object.fromEntries(seriesKeys.map((key) => [key, 0])),
    } as AnalyticsTimelinePoint;
  });

  for (const event of events) {
    if (!event.at || !seriesKeys.includes(event.series)) continue;
    const dateKey = academyDateKey(event.at);
    if (!dateKey) continue;
    const eventOrdinal = dateOrdinal(dateKey);
    const dayOffset = Math.round((eventOrdinal - fromOrdinal) / DAY_MS);
    if (dayOffset < 0 || dayOffset >= totalDays) continue;
    const bucket = points[Math.floor(dayOffset / stepDays)];
    const value = Number(event.value ?? 1);
    if (!bucket || !Number.isFinite(value)) continue;
    bucket[event.series] = Number(bucket[event.series] || 0) + value;
  }

  return points;
}

export function percentage(part: number, total: number, precision = 0) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  const multiplier = 10 ** precision;
  return Math.round((part / total) * 100 * multiplier) / multiplier;
}

export function compactRankedSeries<T>(
  rows: readonly T[],
  score: (row: T) => number,
  limit = 7,
) {
  return [...rows]
    .sort((left, right) => score(right) - score(left))
    .slice(0, Math.max(1, limit));
}

export function rankWithRemainder<T>(
  rows: readonly T[],
  score: (row: T) => number,
  visibleLimit: number,
  mergeRemainder: (rows: readonly T[]) => T,
) {
  const ranked = [...rows].sort((left, right) => score(right) - score(left));
  const safeLimit = Math.max(1, visibleLimit);
  if (ranked.length <= safeLimit) return ranked;
  return [
    ...ranked.slice(0, safeLimit),
    mergeRemainder(ranked.slice(safeLimit)),
  ];
}

export function shortenChartLabel(value: unknown, maxLength = 16) {
  const label = String(value ?? '').trim();
  const safeLength = Math.max(4, maxLength);
  if (label.length <= safeLength) return label;
  return `${label.slice(0, safeLength - 1).trimEnd()}…`;
}
