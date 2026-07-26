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
  fontSize: 11,
} as const;

export const analyticsTooltipStyle = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '0.625rem',
  boxShadow: 'var(--shadow-md)',
  color: 'var(--foreground)',
  fontSize: 12,
  padding: '0.5rem 0.625rem',
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
      'overflow-hidden border-border/60 bg-card shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md',
      className,
    )}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 px-4 pb-2 pt-3.5">
        <div className="min-w-0">
          <CardTitle className="text-[15px] font-semibold leading-5 tracking-tight">{title}</CardTitle>
          {description ? <CardDescription className="mt-0.5 text-xs leading-4">{description}</CardDescription> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 sm:px-4 sm:pb-4">
        <figure aria-label={summary}>
          <div className={cn('h-[236px] min-w-0', chartClassName)}>
            {children}
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
        {footer ? <div className="mt-2.5 border-t border-border/50 pt-2.5">{footer}</div> : null}
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
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] leading-4 text-muted-foreground', className)}>
      {items.map((item) => (
        <span key={item.label} className="inline-flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('h-0.5 w-3 shrink-0 rounded-full', item.dashed && 'border-t-2 border-dashed bg-transparent')}
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
    <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <BarChart3 className="size-4" />
      </span>
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        {description ? <p className="mt-0.5 max-w-sm text-[11px] leading-4 text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
