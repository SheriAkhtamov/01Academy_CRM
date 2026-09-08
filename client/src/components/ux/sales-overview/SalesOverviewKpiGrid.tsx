import { useTranslation } from '@/hooks/useTranslation';
import { isInReportingRange } from '@/lib/reportingDateRange';
import type { SalesDashboardMetrics, SalesOverviewNavTarget, SalesOverviewStats } from './types';

export function SalesOverviewKpiGrid({ metrics, stats, payments, reportingRange, onNavigate }: {
  metrics: SalesDashboardMetrics | undefined; stats: SalesOverviewStats;
  payments: { status?: string | null; paidAt?: string | null; createdAt?: string | null }[];
  reportingRange: { from: string; to: string }; onNavigate: (target: SalesOverviewNavTarget) => void;
}) {
  const { t } = useTranslation();
  const tiles = [
    { title: t('taskInProgress'), value: stats.activeLeads, target: 'pipeline' as const },
    { title: t('salesBookedTrials'), value: metrics?.demoBookings, target: 'pipeline' as const },
    { title: t('salesPaymentsCount'), value: payments.filter((payment) => payment.status === 'paid' && isInReportingRange(payment.paidAt || payment.createdAt, reportingRange)).length, target: 'students' as const },
    { title: t('repeatCallLeads'), value: metrics?.repeatCallLeads, target: null },
  ];
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-1 py-1 xl:col-span-12 xl:grid-cols-4">
    {tiles.map((tile) => {
      const body = <><span className="text-xs text-muted-foreground sm:text-sm">{tile.title}</span><span className="text-lg font-semibold tabular-nums">{tile.value ?? '—'}</span></>;
      return tile.target ? <button type="button" key={tile.title} className="flex min-w-0 items-center justify-between gap-3 rounded px-1 py-2 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onNavigate(tile.target!)} aria-label={tile.target === 'students' ? t('openInStudents') : t('openInPipeline')}>{body}</button>
        : <div key={tile.title} className="flex min-w-0 items-center justify-between gap-3 px-1 py-2">{body}</div>;
    })}
  </div>;
}
