import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isInReportingRange, type ReportingDateRange } from '@/lib/reportingDateRange';
import { buildSalesDailySeries } from '@/lib/salesMetricCharts';
import { TrendBadge } from './parts';
import { overviewPanel } from './OverviewDialog';
import { SalesDailySparkChart } from './SalesDailySparkChart';
import { SalesMetricGauge } from './SalesMetricGauge';
import type { MoneyFormatter, SalesDashboardMetrics, SalesOverviewPayment, SalesOverviewStats, SalesOverviewStudent } from './types';

type PaymentRecord = SalesOverviewPayment & { status?: string | null; paidAt?: string | null; createdAt?: string | null };

export function SalesOverviewHero({ stats, metrics, payments, students, reportingRange, previousRange, money }: {
  stats: SalesOverviewStats; metrics?: SalesDashboardMetrics; payments: PaymentRecord[]; students: SalesOverviewStudent[];
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>; previousRange: { from: string; to: string } | undefined;
  money: MoneyFormatter;
}) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const { revenue, leads, enrolled, current, previous } = useMemo(() => {
    const paid = payments.filter((payment) => payment.status === 'paid');
    const revenue = buildSalesDailySeries(paid.map((payment) => ({ date: payment.paidAt || payment.createdAt, value: Number(payment.amountUzs || 0) })), reportingRange);
    const enrolled = buildSalesDailySeries(students.map((student) => ({ date: student.enrolledAt || student.createdAt, value: 1 })), reportingRange);
    const leads = metrics ? buildSalesDailySeries(metrics.daily.map((point) => ({ date: point.date, value: point.newLeads })), reportingRange) : undefined;
    const previous = previousRange ? paid.filter((payment) => isInReportingRange(payment.paidAt || payment.createdAt, previousRange))
      .reduce((sum, payment) => sum + (Number.isFinite(Number(payment.amountUzs)) ? Number(payment.amountUzs) : 0), 0) : null;
    return { revenue, enrolled, leads, current: revenue.reduce((sum, point) => sum + point.value, 0), previous };
  }, [payments, students, metrics, previousRange, reportingRange]);
  const revenueDelta = previous && previous > 0 ? Math.round((current - previous) / previous * 100) : null;
  const items = [
    { title: t('revenue'), value: money(current), delta: revenueDelta, suffix: '%', points: revenue, kind: 'bars' as const, color: 'text-emerald-600 dark:text-emerald-400', format: (value: number) => money(value) },
    { title: t('newLeads'), value: metrics ? number.format(metrics.newLeads) : '—', delta: metrics ? metrics.newLeads - metrics.previous.newLeads : null, points: leads, kind: 'area' as const, color: 'text-blue-500 dark:text-blue-400', format: (value: number) => number.format(value) },
    { title: t('adminNewStudents'), value: number.format(stats.totalStudents), delta: previousRange ? stats.totalStudents - stats.totalStudentsPrevious : null, points: enrolled, kind: 'stems' as const, color: 'text-violet-500 dark:text-violet-400', format: (value: number) => number.format(value) },
  ];
  const conversion = stats.newLeadsPeriod > 0 ? stats.conversionRate : null;
  const conversionLabel = conversion === null ? '—' : `${number.format(conversion)}%`;
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-12 xl:grid-cols-4">
    {items.map((item) => <section key={item.title} className={`${overviewPanel} flex flex-col p-5`} aria-label={item.title}>
      <header className="flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h2 className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className={`size-1.5 rounded-full bg-current ${item.color}`} aria-hidden="true" />{item.title}</h2>
        {item.delta !== null && item.delta !== 0 ? <TrendBadge delta={item.delta} suffix={item.suffix} className="text-[10px]" /> : null}
      </header>
      <p className="mt-3 break-words text-[clamp(1.45rem,2vw,2rem)] font-semibold leading-tight tracking-tight tabular-nums">{item.value}</p>
      <div className="mt-auto"><SalesDailySparkChart points={item.points} title={item.title} formatValue={item.format} kind={item.kind} className={item.color} /></div>
    </section>)}
    <section className={`${overviewPanel} flex flex-col p-5`} aria-label={t('salesPrimaryConversion')}>
      <header className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />{t('salesPrimaryConversion')}</h2>
        {conversion !== null && previousRange && conversion !== stats.conversionRatePrevious ? <TrendBadge delta={conversion - stats.conversionRatePrevious} suffix={t('percentagePointsShort')} className="text-[10px]" /> : null}
      </header>
      <div className="mx-auto mt-auto w-full max-w-[210px] pt-5">
        <SalesMetricGauge value={conversion} semicircle label={`${t('salesPrimaryConversion')}: ${conversionLabel}`} className="text-amber-500">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{conversionLabel}</p>
        </SalesMetricGauge>
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{number.format(0)}%</span><span>{number.format(100)}%</span></div>
      </div>
      <p className="mt-auto pt-4 text-center text-[11px] text-muted-foreground">{t('salesLeadToPayment')}</p>
    </section>
  </div>;
}
