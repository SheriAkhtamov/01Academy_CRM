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
  timeZone = 'Asia/Tashkent',
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
