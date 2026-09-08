import { ArrowUpRight, Check } from 'lucide-react';
import type { KpiMetric } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { metricKeys } from '../copy';

export function KpiMetricRow({ metric, onSelect, compact = false }: { metric: KpiMetric; onSelect: (metric: KpiMetric) => void; compact?: boolean }) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const suffix = metric.unit === 'percent' ? '%' : '';
  const met = metric.value !== null && metric.target !== null && metric.value >= metric.target;
  const progress = metric.value !== null && metric.target !== null && metric.target > 0 ? Math.min(100, Math.max(0, 100 * metric.value / metric.target)) : 0;
  const remaining = metric.target === null || metric.value === null ? null : Math.max(0, metric.target - metric.value);
  return <button type="button" onClick={() => onSelect(metric)} aria-haspopup="dialog"
    className="group w-full rounded-xl p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={`${t('kpiDetailsTitle')}: ${t(metricKeys[metric.id])}`}>
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{t(metricKeys[metric.id])}</span>
      {!compact ? <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" aria-hidden="true" /> : null}
    </div>
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span className={cn('text-2xl font-semibold tabular-nums tracking-tight', metric.value === null && 'text-lg text-muted-foreground')}>
        {metric.value === null ? t('kpiNoData') : `${number.format(metric.value)}${suffix}`}
        {metric.target !== null ? <span className="ml-2 text-sm font-normal text-muted-foreground">{t('salesPlanLabel').replace('{value}', `${number.format(metric.target)}${suffix}`)}</span> : null}
      </span>
      {!compact ? <span className={cn('flex items-center gap-1 text-xs', met ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
        {met ? <><Check className="size-3.5" aria-hidden="true" />{t('salesPlanReached')}</> : metric.value === null ? t('kpiPending') : remaining !== null && metric.unit === 'count'
          ? t('salesPlanRemaining').replace('{count}', number.format(remaining)) : metric.target !== null ? t('salesPlanProgress') : t('kpiNoTarget')}
      </span> : null}
    </div>
    {metric.target !== null && metric.unit !== 'score' ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t('kpiPlanFact')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <div className={cn('h-full rounded-full', met ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${progress}%` }} />
    </div> : null}
    {!compact && metric.denominator !== undefined ? <p className="mt-2 text-xs text-muted-foreground">{t('salesMetricFraction').replace('{done}', String(metric.numerator ?? 0)).replace('{total}', String(metric.denominator))}</p> : null}
  </button>;
}

export function KpiMetricsGrid({ metrics, onSelect }: { metrics: KpiMetric[]; onSelect: (metric: KpiMetric) => void }) {
  return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{metrics.map((metric) => <div key={metric.id} className="rounded-xl border"><KpiMetricRow metric={metric} onSelect={onSelect} /></div>)}</div>;
}
