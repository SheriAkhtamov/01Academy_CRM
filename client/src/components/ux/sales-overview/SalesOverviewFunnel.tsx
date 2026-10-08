import { useTranslation } from '@/hooks/useTranslation';
import type { SalesDashboardMetrics } from './types';

export function SalesOverviewFunnel({ metrics, isLoading }: {
  metrics: SalesDashboardMetrics | undefined; isLoading: boolean;
}) {
  const { t } = useTranslation();
  const rows = [
    { id: 'new', label: t('newLeads'), value: metrics?.newLeads },
    { id: 'processed', label: t('processedLeads'), value: metrics?.processedLeads },
    { id: 'reached', label: t('reachedLeads'), value: metrics?.reachedLeads },
    { id: 'booked', label: t('salesBookedTrials'), value: metrics?.demoBookings },
  ];
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  return <section className="min-w-0 py-8 xl:col-span-12">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{t('conversionFunnel')}</h2>
    </header>
    <ol className="max-h-72 space-y-4 overflow-y-auto pr-1">
      {rows.map((row) => <li key={row.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_30px] items-center gap-2 sm:grid-cols-[minmax(90px,0.3fr)_minmax(0,1fr)_30px] sm:gap-4">
        <span className="min-w-0 break-words text-xs text-muted-foreground">{row.label}</span>
        <div className="h-3.5 overflow-hidden rounded-full bg-muted/60" aria-hidden="true"><div className="h-full rounded-full bg-primary/75" style={{ width: `${(row.value ?? 0) / max * 100}%` }} /></div>
        <span className="text-right text-xs font-semibold tabular-nums">{isLoading || row.value === undefined ? '—' : row.value}</span>
      </li>)}
    </ol>
  </section>;
}
