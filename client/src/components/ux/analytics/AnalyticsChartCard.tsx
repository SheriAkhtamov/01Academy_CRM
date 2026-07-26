import type { ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const analyticsAxisTick = {
  fill: 'var(--muted-foreground)',
  fontSize: 12,
} as const;

export const analyticsTooltipStyle = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '0.75rem',
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--foreground)',
} as const;

export function AnalyticsChartCard({
  title,
  description,
  summary,
  action,
  children,
  footer,
  className,
  chartClassName,
}: {
  title: string;
  description?: string;
  summary: string;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  chartClassName?: string;
}) {
  return (
    <Card className={cn(
      'group overflow-hidden border-border/70 bg-card/95 shadow-sm transition-shadow duration-200 hover:shadow-md',
      className,
    )}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base leading-6 sm:text-lg">{title}</CardTitle>
          {description ? <CardDescription className="mt-1 leading-5">{description}</CardDescription> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className="px-3 pb-4 pt-0 sm:px-5 sm:pb-5">
        <figure aria-label={summary}>
          <div className={cn('h-[300px] min-w-0', chartClassName)}>
            {children}
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
        {footer ? <div className="mt-4 border-t border-border/60 pt-4">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

export function AnalyticsChartLegend({
  items,
  className,
}: {
  items: Array<{ label: string; color: string; value?: string | number; dashed?: boolean }>;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground', className)}>
      {items.map((item) => (
        <span key={item.label} className="inline-flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('h-0.5 w-4 shrink-0 rounded-full', item.dashed && 'border-t-2 border-dashed bg-transparent')}
            style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color }}
          />
          <span className="truncate">{item.label}</span>
          {item.value !== undefined ? (
            <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function AnalyticsChartEmpty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <BarChart3 className="size-5" />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
