import { ArrowUpRight, Check } from 'lucide-react';
import type { KpiMetric } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { salesTargetCompletion } from '@/lib/salesMetricCharts';
import { SalesMetricGauge, SalesTargetBullet } from '@/components/ux/sales-overview/SalesMetricGauge';
import { metricKeys } from '../copy';

export function KpiMetricRow({ metric, onSelect, compact = false }: { metric: KpiMetric; onSelect: (metric: KpiMetric) => void; compact?: boolean }) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const suffix = metric.unit === 'percent' ? '%' : '';
  const met = metric.value !== null && metric.target !== null && metric.value >= metric.target;
  const completion = salesTargetCompletion(metric.value, metric.target);
  const remaining = metric.target === null || metric.value === null ? null : Math.max(0, metric.target - metric.value);
  const value = metric.value === null ? t('kpiNoData') : `${number.format(metric.value)}${suffix}`;
  const target = metric.target === null ? null : t('salesPlanLabel').replace('{value}', `${number.format(metric.target)}${suffix}`);
  const status = met ? t('salesPlanReached') : metric.value === null ? t('kpiPending') : remaining !== null && metric.unit === 'count'
    ? t('salesPlanRemaining').replace('{count}', number.format(remaining)) : metric.target !== null ? t('salesPlanProgress') : t('kpiNoTarget');
  const color = metric.unit === 'count' ? 'text-blue-500 dark:text-blue-400' : metric.id === 'response' || metric.id === 'renewalConversion' ? 'text-violet-500 dark:text-violet-400' : 'text-emerald-500 dark:text-emerald-400';
  return <button type="button" onClick={() => onSelect(metric)} aria-haspopup="dialog"
    className={cn('group flex h-full w-full flex-col text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', compact ? 'rounded-lg px-1 py-3' : 'rounded-xl border border-border/60 bg-card p-4 hover:border-primary/30')}
    aria-label={`${t('kpiDetailsTitle')}: ${t(metricKeys[metric.id])}`}>
    <div className="mb-4 flex w-full items-start justify-between gap-3">
      <span className="text-xs font-medium leading-5 text-muted-foreground">{t(metricKeys[metric.id])}</span>
      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" aria-hidden="true" />
    </div>
    {metric.unit === 'count' ? <div className="my-auto w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><span className={cn('font-semibold tabular-nums tracking-tight', compact ? 'text-5xl' : 'text-3xl', metric.value === null && 'text-lg text-muted-foreground')}>{value}</span>
        {target ? <span className="text-xs text-muted-foreground">{target}</span> : null}</div>
      {metric.target !== null ? <SalesTargetBullet value={metric.value} target={metric.target} label={`${t('kpiPlanFact')}: ${value}; ${target}`} className={`mt-3 ${color}`} /> : null}
      {completion !== null ? <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{t('salesPlanCompletion').replace('{value}', number.format(completion))}</p> : null}
    </div> : <div className="my-auto flex w-full flex-wrap items-center gap-4">
      <div className={cn('shrink-0', compact ? 'w-[132px]' : 'w-[102px]', color)}>
        <SalesMetricGauge value={metric.value} target={metric.target} min={metric.unit === 'score' ? -100 : 0} semicircle={metric.unit === 'score'} label={`${t(metricKeys[metric.id])}: ${value}; ${target ?? t('kpiNoTarget')}`}>
          <span className={cn('text-2xl font-semibold tracking-tight tabular-nums', metric.value === null && 'text-base text-muted-foreground')}>{metric.value === null ? '—' : value}</span>
        </SalesMetricGauge>
        {metric.unit === 'score' ? <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{number.format(-100)}</span><span>{number.format(100)}</span></div> : null}
      </div>
      <div className="min-w-0 space-y-2 text-xs">
        {metric.value === null ? <p className="text-muted-foreground">{value}</p> : null}
        {target ? <p className="font-medium">{target}</p> : null}
        {metric.denominator !== undefined && metric.denominator > 0 ? <p className="tabular-nums text-muted-foreground">{t('salesMetricFraction').replace('{done}', String(metric.numerator ?? 0)).replace('{total}', String(metric.denominator))}</p> : null}
      </div>
    </div>}
    <div className={cn('mt-4 flex min-h-4 items-center gap-1.5 text-[11px]', met ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
      {met ? <Check className="size-3" aria-hidden="true" /> : <span className={cn('size-1 rounded-full', metric.value === null ? 'bg-muted-foreground/50' : 'bg-current')} aria-hidden="true" />}
      {status}
    </div>
    {!compact && metric.unit === 'count' && metric.denominator !== undefined ? <p className="mt-2 text-xs text-muted-foreground">{t('salesMetricFraction').replace('{done}', String(metric.numerator ?? 0)).replace('{total}', String(metric.denominator))}</p> : null}
  </button>;
}

export function KpiMetricsGrid({ metrics, onSelect }: { metrics: KpiMetric[]; onSelect: (metric: KpiMetric) => void }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{metrics.map((metric) => <KpiMetricRow key={metric.id} metric={metric} onSelect={onSelect} />)}</div>;
}
