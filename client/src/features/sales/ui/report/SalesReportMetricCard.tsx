import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { SalesReportDailyPoint, SalesReportMetric } from '@shared/contracts/sales-report';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { SalesReportTrend, type SalesReportChartKind } from './SalesReportTrend';

export function SalesReportMetricCard({ title, unit, value, daily, metric, icon: Icon, color, kind, cumulative, featured, className, onOpen, leadTotal }: {
  title: string; unit: string; value?: number; daily?: SalesReportDailyPoint[];
  metric: SalesReportMetric; icon: LucideIcon; color: string; kind: SalesReportChartKind;
  cumulative?: boolean; featured?: boolean; className?: string; onOpen?: () => void;
  leadTotal?: number;
}) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language);
  const percentage = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
  const loaded = value !== undefined;
  return <article aria-label={title} style={{ '--metric-color': color } as CSSProperties}
    className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/65 bg-card text-card-foreground shadow-sm',
      'transition-[border-color,box-shadow] duration-200 hover:border-[var(--metric-color)] hover:shadow-md motion-reduce:transition-none', className)}>
    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--metric-color)] opacity-50" />
    <header data-topographic="card" className="relative flex min-h-16 items-start justify-between gap-3 px-5 pt-5">
      <h3 className="min-w-0 pt-1 text-[13px] font-medium leading-5 text-muted-foreground">{title}</h3>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl text-[var(--metric-color)]"
        style={{ backgroundColor: 'color-mix(in srgb, var(--metric-color) 12%, transparent)' }}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
    </header>
    <div className="flex flex-1 flex-col px-5 pb-5">
      <div className="mb-5 flex min-h-16 flex-wrap items-baseline gap-x-3 gap-y-1">
        {loaded ? <>
          {onOpen ? <button type="button" onClick={onOpen} aria-label={`${title}: ${number.format(value)}`}
            className="group flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-[42px]">{number.format(value)}</span>
            <ArrowUpRight className="size-5 text-muted-foreground transition-colors group-hover:text-[var(--metric-color)]" aria-hidden="true" />
          </button> : <p className={cn('font-semibold tracking-tight tabular-nums', featured ? 'text-5xl sm:text-[56px]' : 'text-4xl sm:text-[42px]')}>{number.format(value)}</p>}
          <span className="text-xs text-muted-foreground">{unit}</span>
          {leadTotal !== undefined && leadTotal > 0 ? <span className="basis-full text-[11px] text-muted-foreground">
            {t('salesReportShareOfPeriod', { percent: percentage.format(value / leadTotal) })}
          </span> : null}
        </> : <Skeleton className="h-12 w-24" />}
      </div>
      <div className="mt-auto text-[var(--metric-color)]">
        {loaded && daily ? <SalesReportTrend daily={daily} metric={metric} title={title} kind={kind} cumulative={cumulative} featured={featured} /> :
          <Skeleton className={cn('w-full rounded-xl', featured ? 'h-48' : 'h-40')} />}
      </div>
    </div>
  </article>;
}
