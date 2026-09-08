import { ArrowUpRight, GraduationCap, Megaphone, PhoneCall, UserCheck } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { overviewPanel } from './OverviewDialog';
import { TrendBadge } from './parts';
import type { SalesDashboardMetrics, SalesOverviewNavTarget, SalesOverviewStats } from './types';

export function SalesOverviewKpiGrid({ metrics, stats, isAdministrationModule, isLoading, onNavigate }: {
  metrics: SalesDashboardMetrics | undefined; stats: SalesOverviewStats; isAdministrationModule: boolean;
  isLoading: boolean; onNavigate: (target: SalesOverviewNavTarget) => void;
}) {
  const { t } = useTranslation();
  const tiles = [
    { id: 'newLeads', title: t('newLeads'), hint: t('dataForSelectedPeriod'), icon: Megaphone, value: metrics?.newLeads, previous: metrics?.previous.newLeads, target: 'pipeline' as const },
    { id: 'activeLeads', title: isAdministrationModule ? t('activeLeads') : t('activeMyLeads'), hint: t('inSalesPipeline'), icon: UserCheck, value: stats.activeLeads, previous: stats.activeLeadsPrevious, target: 'pipeline' as const },
    { id: 'repeatCallLeads', title: t('repeatCallLeads'), hint: t('repeatCallLeadsDetail'), icon: PhoneCall, value: metrics?.repeatCallLeads, previous: metrics?.previous.repeatCallLeads, target: null },
    { id: 'studentsForPeriod', title: t('studentsForPeriod'), hint: t('dataForSelectedPeriod'), icon: GraduationCap, value: stats.totalStudents, previous: stats.totalStudentsPrevious, target: 'students' as const },
  ];
  return <section className={`${overviewPanel} p-5`} aria-label={t('salesLeadWork')}>
    <h2 className="mb-3 text-base font-semibold tracking-tight">{t('salesLeadWork')}</h2>
    <div className="divide-y divide-border/60">{tiles.map((tile) => {
      const body = <>
        <span className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground"><tile.icon className="size-4" aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block text-sm font-medium">{tile.title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{tile.hint}</span></span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-2">
          {isLoading && tile.value === undefined ? <span className="h-7 w-12 animate-pulse rounded bg-muted" /> : <span className="text-2xl font-semibold tracking-tight tabular-nums">{tile.value ?? '—'}</span>}
          {tile.value !== undefined && tile.previous !== undefined ? <TrendBadge delta={tile.value - tile.previous} /> : null}
        </span>
        {tile.target ? <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      </>;
      const className = 'flex w-full items-center justify-between gap-3 rounded-lg py-4 text-left';
      return tile.target ? <button type="button" key={tile.id} className={`${className} transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`} onClick={() => onNavigate(tile.target!)} aria-label={tile.target === 'students' ? t('openInStudents') : t('openInPipeline')}>{body}</button>
        : <div key={tile.id} className={className}>{body}</div>;
    })}</div>
  </section>;
}
