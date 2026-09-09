import { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { buildSalesDailySeries } from '@/lib/salesMetricCharts';
import { SalesDailySparkChart } from './SalesDailySparkChart';
import { SalesActiveLeadsChart, SalesRepeatCallsChart } from './SalesOperationalCharts';
import type { SalesDashboardMetrics, SalesOverviewNavTarget, SalesOverviewStats } from './types';

export function SalesOverviewKpiGrid({ metrics, stats, payments, reportingRange, onNavigate, onOpenDemoStudents, leadStatusName, statusColor }: {
  metrics: SalesDashboardMetrics | undefined; stats: SalesOverviewStats;
  payments: { status?: string | null; paidAt?: string | null; createdAt?: string | null }[];
  reportingRange: { from: string; to: string }; onNavigate: (target: SalesOverviewNavTarget) => void;
  onOpenDemoStudents?: () => void;
  leadStatusName: (code: string) => string; statusColor: (code: string) => string;
}) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language);
  const paidDaily = useMemo(() => buildSalesDailySeries(payments.filter((payment) => payment.status === 'paid')
    .map((payment) => ({ date: payment.paidAt || payment.createdAt, value: 1 })), reportingRange), [payments, reportingRange]);
  const bookedDaily = useMemo(() => metrics ? buildSalesDailySeries(metrics.daily.map((point) => ({ date: point.date, value: point.demoBookings })), reportingRange) : undefined, [metrics, reportingRange]);
  const tiles = [
    { title: t('taskInProgress'), value: stats.activeLeads, target: 'pipeline' as const, action: undefined,
      chart: <SalesActiveLeadsChart stages={stats.activeLeadStages} leadStatusName={leadStatusName} statusColor={statusColor} /> },
    { title: t('salesBookedTrials'), value: metrics?.demoBookings, target: undefined, action: onOpenDemoStudents,
      chart: <SalesDailySparkChart points={bookedDaily} title={t('salesBookedTrials')} formatValue={(value) => number.format(value)} kind="bars" compact className="text-cyan-600 dark:text-cyan-400" /> },
    { title: t('salesPaymentsCount'), value: paidDaily.reduce((sum, point) => sum + point.value, 0), target: 'students' as const, action: undefined,
      chart: <SalesDailySparkChart points={paidDaily} title={t('salesPaymentsCount')} formatValue={(value) => number.format(value)} kind="bars" compact className="text-emerald-600 dark:text-emerald-400" /> },
    { title: t('repeatCallLeads'), value: metrics?.repeatCallLeads, target: null, action: undefined,
      chart: <SalesRepeatCallsChart distribution={metrics?.repeatCallDistribution} /> },
  ];
  return <div className="grid grid-cols-1 gap-x-10 border-t border-border/60 xl:col-span-12 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
    {tiles.map((tile) => {
      const isClickable = Boolean(tile.target || tile.action);
      const body = <><span className="flex items-start justify-between gap-2 text-xs font-medium text-muted-foreground">{tile.title}{isClickable ? <ArrowUpRight className="size-3.5 shrink-0 opacity-50 group-hover:opacity-100" aria-hidden="true" /> : null}</span><span className="mt-3 block text-3xl font-semibold tracking-tight tabular-nums">{tile.value === undefined ? '—' : number.format(tile.value)}</span></>;
      const handleClick = () => {
        if (tile.action) {
          tile.action();
        } else if (tile.target) {
          onNavigate(tile.target!);
        }
      };
      const ariaLabel = tile.action
        ? t('demoStudentsModalTitle')
        : tile.target === 'students'
          ? t('openInStudents')
          : t('openInPipeline');

      return <section key={tile.title} className="grid min-w-0 grid-cols-[minmax(85px,0.65fr)_minmax(0,1.4fr)] items-center gap-5 border-b border-border/40 py-6" aria-label={tile.title}>
        {isClickable ? <button type="button" className="group w-full rounded text-left outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={handleClick} aria-label={ariaLabel}>{body}</button> : <div>{body}</div>}
        <div className="min-w-0">{tile.chart}</div>
      </section>;
    })}
  </div>;
}
