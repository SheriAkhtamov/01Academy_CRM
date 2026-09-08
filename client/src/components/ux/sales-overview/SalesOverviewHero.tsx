import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isInReportingRange, type ReportingDateRange } from '@/lib/reportingDateRange';
import { buildSalesDailySeries } from '@/lib/salesMetricCharts';
import { TrendBadge } from './parts';
import { SalesOverviewTrends } from './SalesOverviewTrends';
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
    { title: t('newLeads'), value: metrics ? number.format(metrics.newLeads) : '—', delta: metrics ? metrics.newLeads - metrics.previous.newLeads : null, points: leads, kind: 'area' as const, color: 'text-blue-500 dark:text-blue-400', format: (value: number) => number.format(value) },
    { title: t('adminNewStudents'), value: number.format(stats.totalStudents), delta: previousRange ? stats.totalStudents - stats.totalStudentsPrevious : null, points: enrolled, kind: 'stems' as const, color: 'text-violet-500 dark:text-violet-400', format: (value: number) => number.format(value) },
  ];
  const conversion = stats.newLeadsPeriod > 0 ? stats.conversionRate : null;
  const conversionLabel = conversion === null ? '—' : `${number.format(conversion)}%`;
  return <div className="min-w-0 xl:col-span-12">
    <div className="grid grid-cols-1 gap-10 pb-8 lg:grid-cols-[minmax(0,2fr)_minmax(250px,1fr)]">
      <section className="min-w-0" aria-label={t('revenue')}>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t('revenue')}</h2>
          {revenueDelta !== null && revenueDelta !== 0 ? <TrendBadge delta={revenueDelta} suffix="%" /> : null}
        </header>
        <p className="mt-3 break-words text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-tight tracking-tight tabular-nums">{money(current)}</p>
        <SalesOverviewTrends metrics={metrics} isLoading={!metrics}>
          <SalesDailySparkChart points={revenue} title={t('revenue')} formatValue={(value) => money(value)} kind="bars" expanded className="text-emerald-600 dark:text-emerald-400" />
        </SalesOverviewTrends>
      </section>
      <section className="flex min-w-0 flex-col justify-center border-t border-border/50 pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" aria-label={t('salesPrimaryConversion')}>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('salesPrimaryConversion')}</h2>
          {conversion !== null && previousRange && conversion !== stats.conversionRatePrevious ? <TrendBadge delta={conversion - stats.conversionRatePrevious} suffix={t('percentagePointsShort')} className="text-[10px]" /> : null}
        </header>
        <div className="mx-auto w-full max-w-[330px] pb-2 pt-10">
          <SalesMetricGauge value={conversion} semicircle label={`${t('salesPrimaryConversion')}: ${conversionLabel}`} className="text-amber-500">
            <p className="text-[clamp(2.5rem,4.5vw,4rem)] font-semibold leading-none tracking-tight tabular-nums">{conversionLabel}</p>
          </SalesMetricGauge>
          <div className="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground"><span>{number.format(0)}%</span><span>{number.format(100)}%</span></div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">{t('salesLeadToPayment')}</p>
      </section>
    </div>
    <div className="grid grid-cols-1 gap-x-10 border-t border-border/60 lg:grid-cols-2">
      {items.map((item) => <section key={item.title} className="grid min-w-0 grid-cols-[minmax(90px,0.65fr)_minmax(0,1.4fr)] items-center gap-5 py-6" aria-label={item.title}>
        <div className="min-w-0">
          <h2 className="text-xs font-medium text-muted-foreground">{item.title}</h2>
          <p className="mt-2 break-words text-4xl font-semibold leading-tight tracking-tight tabular-nums">{item.value}</p>
          {item.delta !== null && item.delta !== 0 ? <div className="mt-2"><TrendBadge delta={item.delta} className="text-[10px]" /></div> : null}
        </div>
        <SalesDailySparkChart points={item.points} title={item.title} formatValue={item.format} kind={item.kind} compact className={item.color} />
      </section>)}
    </div>
  </div>;
}
