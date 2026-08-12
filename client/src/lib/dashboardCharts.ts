import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';

export interface RevenuePayment {
  amountUzs?: unknown;
  paidAt?: unknown;
  createdAt?: unknown;
  status?: unknown;
}

export interface MonthlyRevenuePoint {
  month: string;
  amount: number;
}

interface RevenueBucket {
  year: number;
  monthIndex: number;
  amount: number;
}

export function buildMonthlyRevenueData(
  payments: readonly RevenuePayment[],
  locale: string,
  limit = 6,
  timeZone = ACADEMY_TIME_ZONE,
): MonthlyRevenuePoint[] {
  if (limit <= 0) return [];

  const buckets = new Map<number, RevenueBucket>();
  const bucketFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });

  for (const payment of payments) {
    if (payment.status != null && String(payment.status) !== 'paid') continue;
    const rawDate = payment.paidAt || payment.createdAt;
    if (!rawDate) continue;

    const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
    const amount = Number(payment.amountUzs);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) continue;

    const dateParts = Object.fromEntries(
      bucketFormatter.formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const year = dateParts.year;
    const monthIndex = dateParts.month - 1;
    const bucketKey = year * 12 + monthIndex;
    const existing = buckets.get(bucketKey);

    if (existing) {
      existing.amount += amount;
    } else {
      buckets.set(bucketKey, { year, monthIndex, amount });
    }
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    year: '2-digit',
  });

  return [...buckets.entries()]
    .sort(([leftKey], [rightKey]) => leftKey - rightKey)
    .slice(-limit)
    .map(([, bucket]) => ({
      month: formatter.format(new Date(Date.UTC(bucket.year, bucket.monthIndex, 15, 12))),
      amount: bucket.amount,
    }));
}

export function buildReportingRevenueData(
  payments: readonly RevenuePayment[],
  locale: string,
  range: { from: string; to: string },
  timeZone = ACADEMY_TIME_ZONE,
): MonthlyRevenuePoint[] {
  const fromOrdinal = Date.parse(`${range.from}T00:00:00Z`);
  const toOrdinal = Date.parse(`${range.to}T00:00:00Z`);
  if (!Number.isFinite(fromOrdinal) || !Number.isFinite(toOrdinal) || toOrdinal < fromOrdinal) return [];

  const dayMs = 24 * 60 * 60 * 1_000;
  const totalDays = Math.round((toOrdinal - fromOrdinal) / dayMs) + 1;
  const stepDays = totalDays <= 31 ? 1 : totalDays <= 120 ? 7 : Math.ceil(totalDays / 12);
  const bucketCount = Math.ceil(totalDays / stepDays);
  const amounts = Array.from({ length: bucketCount }, () => 0);
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  for (const payment of payments) {
    if (payment.status != null && String(payment.status) !== 'paid') continue;
    const rawDate = payment.paidAt || payment.createdAt;
    if (!rawDate) continue;
    const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
    const amount = Number(payment.amountUzs);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) continue;
    const academyDate = dateFormatter.format(date);
    const ordinal = Date.parse(`${academyDate}T00:00:00Z`);
    const dayOffset = Math.round((ordinal - fromOrdinal) / dayMs);
    if (dayOffset < 0 || dayOffset >= totalDays) continue;
    amounts[Math.floor(dayOffset / stepDays)] += amount;
  }

  const labelFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
  });
  return amounts.map((amount, index) => {
    const bucketStart = new Date(fromOrdinal + index * stepDays * dayMs);
    return {
      month: labelFormatter.format(bucketStart),
      amount,
    };
  });
}
