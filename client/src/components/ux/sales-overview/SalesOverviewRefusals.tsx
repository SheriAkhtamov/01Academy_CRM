import { ChevronRight, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { CardEyebrow, PreviousValue, TrendBadge } from './parts';
import type { SalesDashboardMetrics } from './types';

const REASON_TONES = ['bg-red-500', 'bg-red-400', 'bg-red-300'];

/**
 * Leads that were qualified and still said no — the card that opens the full
 * reason breakdown. The trend is inverted here: more refusals is not progress.
 */
export function SalesOverviewRefusals({
  metrics,
  isLoading,
  archiveReasonName,
  onOpen,
}: {
  metrics: SalesDashboardMetrics | undefined;
  isLoading: boolean;
  archiveReasonName: (code: string) => string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const targetRefusals = metrics?.targetRefusals ?? 0;
  const preview = (metrics?.targetRefusalReasons ?? []).slice(0, 3).map((item) => ({
    ...item,
    share: targetRefusals > 0 ? Math.round((item.count / targetRefusals) * 100) : 0,
  }));

  return (
    <button
      type="button"
      className="h-full w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:col-span-7"
      onClick={onOpen}
      aria-label={t('targetRefusalReasonsTitle')}
      aria-haspopup="dialog"
    >
      <Card className="h-full border-border/60 shadow-sm transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-lg">
        <CardHeader className="px-5 pb-1 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
                <XCircle className="size-4" aria-hidden="true" />
              </span>
              <CardEyebrow>{t('targetRefusals')}</CardEyebrow>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardDescription className="mt-1">{t('targetRefusalsDetail')}</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-4 pt-2">
          {isLoading ? (
            <Skeleton className="h-8 w-16 rounded-md" />
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <span className="text-[30px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                {targetRefusals}
              </span>
              <div className="flex items-center gap-2">
                <TrendBadge
                  delta={metrics === undefined ? null : targetRefusals - metrics.previous.targetRefusals}
                  invert
                />
                <PreviousValue value={String(metrics?.previous.targetRefusals ?? 0)} />
              </div>
            </div>
          )}
          {preview.length ? (
            <div className="mt-3.5 space-y-2.5">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                {preview.map((item, index) => (
                  <span
                    key={item.reason}
                    className={cn('h-full', REASON_TONES[index])}
                    style={{ width: `${item.share}%` }}
                  />
                ))}
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {preview.map((item, index) => (
                  <li key={item.reason} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <span className={cn('size-2.5 shrink-0 rounded-full', REASON_TONES[index])} aria-hidden="true" />
                      <span className="truncate" title={archiveReasonName(item.reason)}>
                        {archiveReasonName(item.reason)}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {item.count} · {item.share}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">{t('targetRefusalReasonsEmpty')}</p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}
