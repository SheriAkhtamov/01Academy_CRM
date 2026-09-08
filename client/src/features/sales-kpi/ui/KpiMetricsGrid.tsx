import { ArrowUpRight, CheckCircle2, CircleDashed } from 'lucide-react';
import type { KpiMetric } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { metricKeys } from '../copy';

export function KpiMetricsGrid({ metrics, onSelect }: { metrics: KpiMetric[]; onSelect: (metric: KpiMetric) => void }) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {metrics.map((metric) => {
      const met = metric.value !== null && metric.target !== null && metric.value >= metric.target;
      const progress = metric.value !== null && metric.target !== null && metric.target > 0 ? Math.min(100, Math.max(0, 100 * metric.value / metric.target)) : 0;
      return <button type="button" key={metric.id} onClick={() => onSelect(metric)}
        className={cn('group flex min-w-0 flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          met && 'border-emerald-600/25')}
        aria-label={`${t('kpiDetailsTitle')}: ${t(metricKeys[metric.id])}`}>
        <div className="flex w-full items-start justify-between gap-3"><span className="text-xs font-medium text-muted-foreground">{t(metricKeys[metric.id])}</span>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" /></div>
        <div className="mt-3 flex items-baseline gap-2"><span className={cn('text-3xl font-semibold tabular-nums tracking-tight', metric.value === null && 'text-lg text-muted-foreground')}>
          {metric.value === null ? t('kpiNoData') : `${number.format(metric.value)}${metric.unit === 'percent' ? '%' : ''}`}</span>
          {metric.target !== null ? <span className="text-xs text-muted-foreground">{t('kpiTarget')}: {number.format(metric.target)}{metric.unit === 'percent' ? '%' : ''}</span> : null}
        </div>
        <div className="mt-4 w-full space-y-2">
          {metric.target !== null && metric.unit !== 'score' ? <Progress value={progress} className="h-1.5" aria-label={t('kpiPlanFact')} /> : null}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{metric.denominator !== undefined ? `${metric.numerator ?? 0} / ${metric.denominator}` : (metric.target === null ? t('kpiNoTarget') : met ? t('kpiEarned') : t('kpiNotMet'))}</span>
            {met ? <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden="true" /> : metric.value === null ? <CircleDashed className="size-3.5" aria-hidden="true" /> : null}
          </div>
        </div>
      </button>;
    })}
  </div>;
}
