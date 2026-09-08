import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { overviewPanel } from './OverviewDialog';
import type { SalesDashboardMetrics, SalesOverviewFunnelStage } from './types';

export function SalesOverviewFunnel({ metrics, isLoading, funnel, leadStatusName, statusColor }: {
  metrics: SalesDashboardMetrics | undefined; isLoading: boolean; funnel: SalesOverviewFunnelStage[];
  leadStatusName: (code: string) => string; statusColor: (code: string) => string;
}) {
  const { t } = useTranslation();
  const [stages, setStages] = useState(false);
  const rows = stages ? funnel.map((stage) => ({ id: stage.code, label: leadStatusName(stage.code), value: stage.count, color: stage.color || statusColor(stage.code) })) : [
    { id: 'new', label: t('newLeads'), value: metrics?.newLeads },
    { id: 'processed', label: t('processedLeads'), value: metrics?.processedLeads },
    { id: 'reached', label: t('reachedLeads'), value: metrics?.reachedLeads },
    { id: 'qualified', label: t('qualifiedLeads'), value: metrics?.qualifiedLeads },
    { id: 'booked', label: t('salesBookedTrials'), value: metrics?.demoBookings },
  ];
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  const buttonClass = 'rounded-md px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';
  return <section className={`${overviewPanel} p-5 sm:p-6 xl:col-span-5`}>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{t('conversionFunnel')}</h2>
      <div className="flex rounded-lg bg-muted/60 p-1" role="group" aria-label={t('conversionFunnel')}>
        <button type="button" aria-pressed={!stages} className={cn(buttonClass, !stages ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => setStages(false)}>{t('funnelProcessTab')}</button>
        <button type="button" aria-pressed={stages} className={cn(buttonClass, stages ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => setStages(true)}>{t('funnelStageTab')}</button>
      </div>
    </header>
    <ol className="max-h-72 space-y-4 overflow-y-auto pr-1">
      {rows.map((row) => <li key={row.id}>
        <div className="mb-2 flex items-center justify-between gap-4 text-xs"><span className="text-muted-foreground">{row.label}</span><span className="font-semibold tabular-nums">{isLoading && !stages || row.value === undefined ? '—' : row.value}</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-muted/60" aria-hidden="true"><div className="h-full rounded-full bg-primary/75" style={{ width: `${(row.value ?? 0) / max * 100}%`, ...('color' in row && row.color ? { backgroundColor: row.color } : {}) }} /></div>
      </li>)}
    </ol>
  </section>;
}
