import { useMemo, type ReactNode } from 'react';
import { ArrowLeftRight, Banknote, CreditCard, Percent } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { isInReportingRange, type ReportingDateRange } from '@/lib/reportingDateRange';
import { TrendBadge } from './parts';
import { overviewPanel } from './OverviewDialog';
import type { MoneyFormatter, SalesOverviewPayment } from './types';

type PaymentRecord = SalesOverviewPayment & { status?: string | null; paidAt?: string | null; createdAt?: string | null };

export function SalesOverviewHero({ conversionRate, conversionRatePrevious, showValue, payments, reportingRange, previousRange, money, compensation }: {
  conversionRate: number; conversionRatePrevious: number; showValue: boolean; payments: PaymentRecord[];
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>; previousRange: { from: string; to: string } | undefined;
  money: MoneyFormatter; compensation: ReactNode;
}) {
  const { t, language } = useTranslation();
  const { current, previous } = useMemo(() => {
    const paid = payments.filter((payment) => payment.status === 'paid');
    const totals = (range: { from: string; to: string }) => {
      const items = paid.filter((payment) => isInReportingRange(payment.paidAt || payment.createdAt, range));
      const revenue = items.reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
      return { count: items.length, revenue, average: items.length ? Math.round(revenue / items.length) : 0 };
    };
    return { current: totals(reportingRange), previous: previousRange ? totals(previousRange) : null };
  }, [payments, previousRange, reportingRange]);
  const formatDate = (value: string) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  const revenueDelta = previous && previous.revenue > 0 ? Math.round((current.revenue - previous.revenue) / previous.revenue * 100) : null;
  const items = [
    { title: t('revenueForPeriod'), value: money(current.revenue), icon: Banknote, hint: `${t('avgPaymentSize')}: ${money(current.average)}`, delta: revenueDelta, suffix: '%', before: previous ? money(previous.revenue) : null },
    { title: t('salesPaymentsCount'), value: String(current.count), icon: CreditCard, hint: t('salesPaymentsHint'), delta: previous ? current.count - previous.count : null, suffix: undefined, before: previous ? String(previous.count) : null },
    { title: t('salesPrimaryConversion'), value: showValue ? `${conversionRate}%` : '—', icon: Percent, hint: t('paidOverAllLeads'), delta: showValue && previousRange ? conversionRate - conversionRatePrevious : null, suffix: t('percentagePointsShort'), before: showValue && previousRange ? `${conversionRatePrevious}%` : null },
  ];
  return <div className="space-y-3 xl:col-span-12">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => <section key={item.title} className={`${overviewPanel} flex flex-col p-5 sm:p-6 ${index === 0 ? 'border-primary/25 bg-primary/[0.035]' : ''}`} aria-label={item.title}>
        <div className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground"><h2>{item.title}</h2><item.icon className="size-4 shrink-0" aria-hidden="true" /></div>
        <p className="mt-3 break-words text-[clamp(1.25rem,1.8vw,1.875rem)] font-semibold tracking-tight tabular-nums">{item.value}</p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{item.hint}</p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          {item.delta !== null ? <TrendBadge delta={item.delta} suffix={item.suffix} /> : null}
          {item.before !== null ? <span className="text-xs tabular-nums text-muted-foreground">{t('before')} {item.before}</span> : null}
        </div>
      </section>)}
      {compensation}
    </div>
    {previousRange ? <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><ArrowLeftRight className="size-3" aria-hidden="true" />{t('salesOverviewComparedWith')} {formatDate(previousRange.from)} — {formatDate(previousRange.to)}</p> : null}
  </div>;
}
