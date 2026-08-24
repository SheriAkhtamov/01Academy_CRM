import { RotateCcw, XCircle } from 'lucide-react';
import type { financeCopy } from '@/lib/financeCenter';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StaggerItem } from '@/components/ux/motion';
import { AnalyticsChartsSkeleton } from '@/components/ux/analytics/AnalyticsChartCard';

export function FinanceMetric({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  large = false,
  detail,
  fullValue,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
  large?: boolean;
  detail?: React.ReactNode;
  fullValue?: string;
}) {
  return (
    <StaggerItem preset="pop" className="h-full">
    <Card className={cn(
      'h-full overflow-hidden border-border/60 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:border-border hover:shadow-lg',
      large && 'border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20',
    )}>
      <CardContent className="flex h-full items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p title={fullValue} className={cn(
            'mt-1 block max-w-full truncate whitespace-nowrap font-bold tabular-nums tracking-tight text-foreground',
            large ? 'text-[26px] text-emerald-700' : 'text-xl',
            tone === 'success' && !large && 'text-emerald-700',
            tone === 'danger' && 'text-destructive',
            tone === 'warning' && 'text-amber-700',
          )}>
            {value}
          </p>
          {detail ? <div className="mt-1.5 text-xs leading-4 text-muted-foreground">{detail}</div> : null}
        </div>
        <div className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
          tone === 'success' && 'bg-emerald-100 text-emerald-700',
          tone === 'danger' && 'bg-destructive/10 text-destructive',
          tone === 'warning' && 'bg-amber-100 text-amber-700',
          large && 'bg-emerald-100 text-emerald-700',
        )}>
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
    </StaggerItem>
  );
}

export function FinanceLoading({
  showAnalytics = false,
  metricCards = 4,
}: {
  showAnalytics?: boolean;
  metricCards?: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className={cn(
        'grid gap-3 md:grid-cols-2',
        showAnalytics ? 'xl:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))]' : 'xl:grid-cols-4',
      )}>
        {Array.from({ length: metricCards }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-[300px] rounded-xl" />
      {showAnalytics ? <AnalyticsChartsSkeleton cards={2} /> : null}
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

export function FinanceError({ copy, onRetry }: { copy: ReturnType<typeof financeCopy>; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
        <XCircle className="size-9 text-destructive" />
        <p className="text-sm text-muted-foreground">{copy.error}</p>
        <Button variant="outline" onClick={onRetry}><RotateCcw data-icon="inline-start" />{copy.retry}</Button>
      </CardContent>
    </Card>
  );
}
