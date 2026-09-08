import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export { AnalyticsChartEmpty, AnalyticsChartLegend, analyticsAxisTick, analyticsTooltipStyle } from '@/components/ux/analytics/AnalyticsChartCard';

export function AnalyticsChartCard({ title, description, summary, action, children, footer, className, chartClassName }: {
  title: string; description?: string; summary: string; action?: ReactNode; children: ReactNode;
  footer?: ReactNode; className?: string; chartClassName?: string;
}) {
  const titleId = useId();
  const summaryId = useId();
  return <section className={cn('min-w-0 p-5 text-card-foreground sm:p-6', className)}>
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id={titleId} className="text-sm font-semibold">{title}</h2>{description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}</div>
      {action}
    </header>
    <figure className="min-w-0" aria-labelledby={titleId} aria-describedby={summaryId}>
      <div className={cn('h-[236px] min-w-0', chartClassName)}>{children}</div>
      <figcaption id={summaryId} className="sr-only">{summary}</figcaption>
    </figure>
    {footer ? <div className="mt-4 border-t border-border/50 pt-4">{footer}</div> : null}
  </section>;
}

export function OverviewSkeleton({ className }: { className: string }) {
  return <div className={cn('animate-pulse bg-muted', className)} aria-hidden="true" />;
}
