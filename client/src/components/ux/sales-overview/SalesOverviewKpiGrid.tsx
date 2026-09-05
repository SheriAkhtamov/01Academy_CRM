import { ArrowUpRight, GraduationCap, Megaphone, PhoneCall, UserCheck, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedNumber, StaggerGroup, StaggerItem } from '@/components/ux/motion';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { PreviousValue, Sparkline, TrendBadge } from './parts';
import type {
  SalesDashboardMetrics,
  SalesOverviewNavTarget,
  SalesOverviewStats,
} from './types';

interface KpiTile {
  id: string;
  title: string;
  hint: string | null;
  icon: LucideIcon;
  iconClass: string;
  value: number;
  previous: number | undefined;
  /** Only the series the metrics endpoint actually returns per day. */
  series: number[] | null;
  seriesColor: string;
  target: SalesOverviewNavTarget | null;
  isLoading?: boolean;
}

/**
 * The four headline counters.
 *
 * Two things changed from the number-only tiles that came before. Each tile
 * now spells out the figure it is being compared against instead of hiding it
 * in a `title` attribute, and the tiles that have somewhere to go are buttons:
 * an overview you cannot leave from is a wall poster, not a starting point.
 *
 * The sparkline slot is reserved on every tile but only drawn where the
 * endpoint really returns a daily series. Three of these counters are derived
 * from the module dataset and have no per-day history, and inventing a shape
 * for them would be worse than the empty strip.
 */
export function SalesOverviewKpiGrid({
  metrics,
  stats,
  isAdministrationModule,
  isLoading,
  onNavigate,
}: {
  metrics: SalesDashboardMetrics | undefined;
  stats: SalesOverviewStats;
  isAdministrationModule: boolean;
  isLoading: boolean;
  onNavigate: (target: SalesOverviewNavTarget) => void;
}) {
  const { t } = useTranslation();

  const tiles: KpiTile[] = [
    {
      id: 'newLeads',
      title: t('newLeads'),
      hint: t('dataForSelectedPeriod'),
      icon: Megaphone,
      iconClass: 'bg-[var(--primary-500)]/10 text-[var(--primary-500)]',
      value: metrics?.newLeads ?? 0,
      previous: metrics?.previous.newLeads,
      series: (metrics?.daily ?? []).map((point) => point.newLeads),
      seriesColor: 'var(--primary-500)',
      target: 'pipeline',
      isLoading,
    },
    {
      id: 'activeLeads',
      title: isAdministrationModule ? t('activeLeads') : t('activeMyLeads'),
      hint: t('inSalesPipeline'),
      icon: UserCheck,
      iconClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      value: stats.activeLeads,
      previous: stats.activeLeadsPrevious,
      series: null,
      seriesColor: 'var(--chart-3)',
      target: 'pipeline',
    },
    {
      id: 'repeatCallLeads',
      title: t('repeatCallLeads'),
      hint: t('repeatCallLeadsDetail'),
      icon: PhoneCall,
      iconClass: 'bg-[var(--chart-2)]/10 text-[var(--chart-2)]',
      value: metrics?.repeatCallLeads ?? 0,
      previous: metrics?.previous.repeatCallLeads,
      series: null,
      seriesColor: 'var(--chart-2)',
      target: null,
      isLoading,
    },
    {
      id: 'studentsForPeriod',
      title: t('studentsForPeriod'),
      hint: null,
      icon: GraduationCap,
      iconClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      value: stats.totalStudents,
      previous: stats.totalStudentsPrevious,
      series: null,
      seriesColor: 'var(--chart-1)',
      target: 'students',
    },
  ];

  return (
    <StaggerGroup
      count={tiles.length}
      className="grid grid-cols-tile gap-3 xl:col-span-12"
      role="group"
      aria-label={t('periodMetricsGroup')}
    >
      {tiles.map((tile) => {
        const delta = tile.previous === undefined ? null : tile.value - tile.previous;
        const body = (
          <Card
            className={cn(
              'h-full border-border/60 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out',
              'hover:-translate-y-1 hover:border-border hover:shadow-lg',
            )}
          >
            <CardContent className="flex h-full flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-muted-foreground">{tile.title}</p>
                  {tile.hint ? (
                    <p className="mt-0.5 hidden truncate text-[11px] leading-4 text-muted-foreground md:block">
                      {tile.hint}
                    </p>
                  ) : null}
                </div>
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', tile.iconClass)}>
                  <tile.icon className="size-4" aria-hidden="true" />
                </span>
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                {tile.isLoading ? (
                  <Skeleton className="h-8 w-20 rounded-md" />
                ) : (
                  <div className="text-[28px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                    <AnimatedNumber value={tile.value} />
                  </div>
                )}
                <TrendBadge delta={delta} />
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <PreviousValue value={String(tile.previous ?? 0)} />
                {tile.target ? (
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                ) : null}
              </div>

              <div className="mt-2 flex h-7 items-end">
                {tile.series && tile.series.length > 1 ? (
                  <Sparkline values={tile.series} color={tile.seriesColor} />
                ) : null}
              </div>
            </CardContent>
          </Card>
        );

        return (
          <StaggerItem key={tile.id} preset="pop" className="h-full">
            {tile.target ? (
              <button
                type="button"
                className="h-full w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => onNavigate(tile.target!)}
                aria-label={tile.target === 'students' ? t('openInStudents') : t('openInPipeline')}
              >
                {body}
              </button>
            ) : body}
          </StaggerItem>
        );
      })}
    </StaggerGroup>
  );
}
