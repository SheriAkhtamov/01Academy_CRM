import { useMemo } from 'react';
import { ArrowLeftRight, Percent } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/ux/motion';
import { useTranslation } from '@/hooks/useTranslation';
import { isInReportingRange, type ReportingDateRange } from '@/lib/reportingDateRange';
import { ConversionRing, PreviousValue, TrendBadge } from './parts';
import type { MoneyFormatter, SalesOverviewPayment } from './types';

type PaymentRecord = SalesOverviewPayment & {
  status?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
};

const sumAmount = (payments: PaymentRecord[]) => (
  payments.reduce((total, payment) => total + Number(payment.amountUzs || 0), 0)
);

/** Relative change, because an absolute delta in UZS is unreadable at a glance. */
const percentDelta = (current: number, previous: number | null) => {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
};

function HeroStat({
  title,
  value,
  delta,
  suffix,
  previous,
}: {
  title: string;
  value: React.ReactNode;
  delta: number | null;
  suffix?: string;
  previous: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-muted-foreground" title={title}>{title}</p>
      <p className="mt-1.5 truncate text-[26px] font-bold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <TrendBadge delta={delta} suffix={suffix} />
        {previous === null ? null : <PreviousValue value={previous} />}
      </div>
    </div>
  );
}

/**
 * The band that answers "how did the period go" before any chart is read.
 *
 * Money used to live only in a legend footnote under the revenue chart, which
 * is a strange place for the number a sales module is judged on. It sits here
 * now, and the chart's footer no longer repeats it.
 *
 * The previous window comes from the metrics endpoint (`previousRange`) rather
 * than being recomputed here, so the money comparison covers exactly the same
 * days as every other trend badge on the screen.
 */
export function SalesOverviewHero({
  conversionRate,
  conversionRatePrevious,
  showValue,
  payments,
  reportingRange,
  previousRange,
  money,
}: {
  conversionRate: number;
  conversionRatePrevious: number;
  showValue: boolean;
  payments: PaymentRecord[];
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>;
  previousRange: { from: string; to: string } | undefined;
  money: MoneyFormatter;
}) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';

  /* The window every trend badge on this band is measured against, spelled
     out. It is the server's own `previousRange`, so the money comparison and
     the counted-event comparisons cover exactly the same days. */
  const comparedWith = useMemo(() => {
    if (!previousRange) return null;
    const format = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' });
    const at = (value: string) => format.format(new Date(`${value}T00:00:00Z`));
    return `${at(previousRange.from)} — ${at(previousRange.to)}`;
  }, [locale, previousRange]);

  const { current, previous } = useMemo(() => {
    const paid = payments.filter((payment) => payment.status === 'paid');
    const inWindow = (range: { from: string; to: string }) => paid.filter(
      (payment) => isInReportingRange(payment.paidAt || payment.createdAt, range),
    );
    const currentPaid = inWindow(reportingRange);
    const previousPaid = previousRange ? inWindow(previousRange) : null;
    const totals = (items: PaymentRecord[] | null) => (items === null ? null : {
      count: items.length,
      revenue: sumAmount(items),
      average: items.length > 0 ? Math.round(sumAmount(items) / items.length) : 0,
    });
    return { current: totals(currentPaid)!, previous: totals(previousPaid) };
  }, [payments, previousRange, reportingRange]);

  return (
    <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-[var(--primary-500)]/[0.07] via-card to-card shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md xl:col-span-12">
      <CardContent className="p-5">
        {comparedWith ? (
          <p className="mb-3.5 flex items-center justify-end gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <ArrowLeftRight className="size-3 shrink-0" aria-hidden="true" />
            {t('salesOverviewComparedWith')} {comparedWith}
          </p>
        ) : null}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-7">
        <div className="flex shrink-0 items-center gap-4">
          <ConversionRing percent={conversionRate} showValue={showValue} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-500)]/10 text-[var(--primary-500)]">
                <Percent className="size-4" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold text-foreground">{t('conversionForPeriod')}</p>
            </div>
            <p className="mt-1.5 text-xs leading-4 text-muted-foreground">{t('paidOverAllLeads')}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <TrendBadge delta={conversionRate - conversionRatePrevious} suffix="%" />
              <PreviousValue value={`${conversionRatePrevious}%`} />
            </div>
          </div>
        </div>

        <span className="hidden w-px self-stretch bg-border lg:block" aria-hidden="true" />

        <div className="grid min-w-0 flex-1 gap-5 sm:grid-cols-3">
          <HeroStat
            title={t('paidCustomersForPeriod')}
            value={<AnimatedNumber value={current.count} />}
            delta={previous === null ? null : current.count - previous.count}
            previous={previous === null ? null : String(previous.count)}
          />
          <HeroStat
            title={t('revenueForPeriod')}
            value={<AnimatedNumber value={current.revenue} format={money} />}
            delta={percentDelta(current.revenue, previous === null ? null : previous.revenue)}
            suffix="%"
            previous={previous === null ? null : money(previous.revenue)}
          />
          <HeroStat
            title={t('avgPaymentSize')}
            value={<AnimatedNumber value={current.average} format={money} />}
            delta={percentDelta(current.average, previous === null ? null : previous.average)}
            suffix="%"
            previous={previous === null ? null : money(previous.average)}
          />
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
