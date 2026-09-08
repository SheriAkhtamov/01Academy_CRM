import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isInReportingRange, type ReportingDateRange } from '@/lib/reportingDateRange';
import { TrendBadge } from './parts';
import { overviewPanel } from './OverviewDialog';
import type { MoneyFormatter, SalesDashboardMetrics, SalesOverviewPayment, SalesOverviewStats } from './types';

type PaymentRecord = SalesOverviewPayment & { status?: string | null; paidAt?: string | null; createdAt?: string | null };

export function SalesOverviewHero({ stats, metrics, payments, reportingRange, previousRange, money }: {
  stats: SalesOverviewStats; metrics?: SalesDashboardMetrics; payments: PaymentRecord[];
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>; previousRange: { from: string; to: string } | undefined;
  money: MoneyFormatter;
}) {
  const { t } = useTranslation();
  const { current, previous } = useMemo(() => {
    const paid = payments.filter((payment) => payment.status === 'paid');
    const total = (range: { from: string; to: string }) => paid.filter((payment) => isInReportingRange(payment.paidAt || payment.createdAt, range))
      .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
    return { current: total(reportingRange), previous: previousRange ? total(previousRange) : null };
  }, [payments, previousRange, reportingRange]);
  const revenueDelta = previous && previous > 0 ? Math.round((current - previous) / previous * 100) : null;
  const items = [
    { title: t('revenue'), value: money(current), delta: revenueDelta, suffix: '%' },
    { title: t('newLeads'), value: metrics ? String(metrics.newLeads) : '—', delta: metrics ? metrics.newLeads - metrics.previous.newLeads : null },
    { title: t('adminNewStudents'), value: String(stats.totalStudents), delta: previousRange ? stats.totalStudents - stats.totalStudentsPrevious : null },
    { title: t('salesPrimaryConversion'), value: stats.newLeadsPeriod > 0 ? `${stats.conversionRate}%` : '—', delta: stats.newLeadsPeriod > 0 && previousRange ? stats.conversionRate - stats.conversionRatePrevious : null, suffix: t('percentagePointsShort') },
  ];
  return <div className={`${overviewPanel} grid grid-cols-2 overflow-hidden xl:col-span-12 xl:grid-cols-[1.4fr_1fr_1fr_1fr]`}>
    {items.map((item, index) => <section key={item.title} className={`min-w-0 px-5 py-6 sm:px-6 sm:py-7 ${index > 1 ? 'border-t xl:border-t-0' : ''} ${index % 2 ? 'border-l' : index ? 'xl:border-l' : ''}`} aria-label={item.title}>
      <h2 className="text-xs font-medium text-muted-foreground sm:text-sm">{item.title}</h2>
      <p className="mt-3 break-words text-[clamp(1.5rem,2.2vw,2.25rem)] font-semibold leading-tight tracking-tight tabular-nums">{item.value}</p>
      {item.delta !== null && item.delta !== 0 ? <div className="mt-3"><TrendBadge delta={item.delta} suffix={item.suffix} /></div> : null}
    </section>)}
  </div>;
}
