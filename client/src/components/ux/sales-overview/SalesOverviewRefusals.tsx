import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { TrendBadge } from './parts';
import type { SalesDashboardMetrics } from './types';

export function SalesOverviewRefusals({ metrics, isLoading, archiveReasonName, onOpen }: {
  metrics: SalesDashboardMetrics | undefined; isLoading: boolean; archiveReasonName: (code: string) => string; onOpen: () => void;
}) {
  const { t } = useTranslation();
  const count = metrics?.targetRefusals;
  const top = metrics?.targetRefusalReasons[0];
  return <button type="button" className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 py-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:col-span-12"
    onClick={onOpen} aria-label={t('targetRefusalReasonsTitle')} aria-haspopup="dialog">
    <span><span className="block text-sm font-medium">{t('targetRefusals')}</span></span>
    <span className="flex items-center gap-3"><span className="text-2xl font-semibold tabular-nums">{isLoading || count === undefined ? '—' : count}</span>{metrics ? <TrendBadge delta={metrics.targetRefusals - metrics.previous.targetRefusals} invert /> : null}</span>
    <span className="min-w-0 flex-1 text-xs text-muted-foreground sm:text-right">{top ? `${archiveReasonName(top.reason)} · ${top.count}` : t('targetRefusalReasonsEmpty')}</span>
    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </button>;
}
