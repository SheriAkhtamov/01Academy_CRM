import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  BadgeCheck,
  CalendarCheck,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Megaphone,
  Percent,
  PhoneCall,
  RefreshCcw,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { LEAD_ARCHIVE_REASONS } from '@shared/academy';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  reportingRangeQuery,
  type ReportingDateRange,
} from '@/lib/reportingDateRange';

interface SalesDashboardMetrics {
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
  qualifiedLeads: number;
  demoBookings: number;
  repeatCallLeads: number;
  targetRefusals: number;
  targetRefusalReasons: Array<{
    reason: string;
    count: number;
  }>;
}

type SalesOverviewMetricsProps = {
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>;
  isAdministrationWorkspace: boolean;
  activeLeads: number;
  totalStudents: number;
  conversionLeadCount: number;
  conversionRate: number;
};

const archiveReasonTranslationKeys = Object.fromEntries(
  LEAD_ARCHIVE_REASONS.map((reason) => [reason.code, reason.translationKey]),
) as Record<string, TranslationKey>;

type KpiTone = 'blue' | 'green' | 'amber' | 'red' | 'slate';
type KpiEmphasis = 'hero' | 'compact' | 'risk';

const KPI_TONE_STYLES: Record<KpiTone, {
  accent: string;
  icon: string;
  surface: string;
}> = {
  blue: {
    accent: 'bg-[var(--primary-500)]',
    icon: 'bg-primary-50 text-primary-600',
    surface: 'bg-gradient-to-br from-card via-card to-[var(--tint-blue)]',
  },
  green: {
    accent: 'bg-[var(--chart-1)]',
    icon: 'bg-emerald-100 text-emerald-600',
    surface: 'bg-gradient-to-br from-card via-card to-[var(--tint-green)]',
  },
  amber: {
    accent: 'bg-[var(--chart-3)]',
    icon: 'bg-amber-100 text-amber-600',
    surface: 'bg-gradient-to-br from-card via-card to-[var(--tint-amber)]',
  },
  red: {
    accent: 'bg-destructive',
    icon: 'bg-[var(--tint-red)] text-destructive',
    surface: 'bg-gradient-to-br from-card via-card to-[var(--tint-red)]',
  },
  slate: {
    accent: 'bg-[var(--chart-6)]',
    icon: 'bg-muted text-muted-foreground',
    surface: 'bg-card',
  },
};

function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'blue',
  emphasis = 'compact',
  isLoading = false,
  onClick,
  actionLabel,
  className,
  children,
}: {
  title: string;
  value: ReactNode;
  detail?: string;
  icon: LucideIcon;
  tone?: KpiTone;
  emphasis?: KpiEmphasis;
  isLoading?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  const toneStyles = KPI_TONE_STYLES[tone];
  const isHero = emphasis === 'hero';
  const card = (
    <Card
      className={cn(
        'relative h-full overflow-hidden border-border shadow-sm',
        toneStyles.surface,
        isHero ? 'min-h-[150px] rounded-2xl' : 'min-h-[126px]',
        onClick && 'transition-[border-color,box-shadow] duration-200 group-hover:border-destructive group-hover:shadow-md',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-0.5', toneStyles.accent)} />
      <CardContent className={cn('flex h-full flex-col p-4', isHero && 'p-5')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className={cn(
                'line-clamp-2 font-medium text-muted-foreground',
                isHero ? 'text-sm leading-5' : 'min-h-8 text-xs leading-4',
              )}
              title={title}
            >
              {title}
            </p>
          </div>
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl',
              isHero ? 'size-11' : 'size-9',
              toneStyles.icon,
            )}
          >
            <Icon className={isHero ? 'size-5' : 'size-4'} aria-hidden="true" />
          </div>
        </div>
        <div className={cn('mt-auto', isHero ? 'pt-5' : 'pt-3')}>
          {isLoading ? (
            <Skeleton className={cn('rounded-md', isHero ? 'h-9 w-24' : 'h-7 w-20')} />
          ) : (
            <div
              className={cn(
                'font-bold leading-none tracking-tight tabular-nums text-foreground',
                isHero ? 'text-[32px]' : 'text-[24px]',
              )}
            >
              {value}
            </div>
          )}
          {detail ? (
            <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
              <p className="line-clamp-2 text-xs leading-4 text-muted-foreground" title={detail}>
                {detail}
              </p>
              {onClick ? (
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );

  return (
    <div className={cn('min-w-0', className)}>
      {onClick ? (
        <button
          type="button"
          className="group h-full w-full cursor-pointer rounded-2xl text-left outline-none transition-opacity duration-150 active:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={onClick}
          aria-label={actionLabel ?? title}
          aria-haspopup="dialog"
        >
          {card}
        </button>
      ) : card}
    </div>
  );
}

export function SalesOverviewMetrics({
  reportingRange,
  isAdministrationWorkspace,
  activeLeads,
  totalStudents,
  conversionLeadCount,
  conversionRate,
}: SalesOverviewMetricsProps) {
  const { t } = useTranslation();
  const [targetRefusalDialogOpen, setTargetRefusalDialogOpen] = useState(false);
  const reportingQuery = reportingRangeQuery(reportingRange);
  const metricsQuery = useQuery<SalesDashboardMetrics>({
    queryKey: ['/api/academy/workspaces/sales/metrics', reportingQuery],
    queryFn: () => apiRequest('GET', `/api/academy/workspaces/sales/metrics?${reportingQuery}`),
    placeholderData: (previousData) => previousData,
  });
  const archiveReasonName = (code: string) => {
    const key = archiveReasonTranslationKeys[code];
    return key ? t(key) : code;
  };
  const targetRefusals = metricsQuery.data?.targetRefusals ?? 0;
  const refusalReasonPreview = (metricsQuery.data?.targetRefusalReasons ?? [])
    .slice(0, 3)
    .map((item) => ({
      ...item,
      share: targetRefusals > 0 ? Math.round((item.count / targetRefusals) * 100) : 0,
    }));

  return (
    <>
      {metricsQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>{t('failedToLoadData')}</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => metricsQuery.refetch()}
            >
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-3" aria-busy={metricsQuery.isPending}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard
            title={t('conversionForPeriod')}
            value={conversionLeadCount > 0 ? `${conversionRate}%` : t('noData')}
            detail={t('paidOverAllLeads')}
            icon={Percent}
            emphasis="hero"
            tone={conversionLeadCount === 0
              ? 'slate'
              : conversionRate >= 30
                ? 'green'
                : conversionRate >= 15
                  ? 'amber'
                  : 'red'}
          />
          <KpiCard
            title={isAdministrationWorkspace ? t('activeLeads') : t('activeMyLeads')}
            value={activeLeads}
            detail={t('inSalesPipeline')}
            icon={UserCheck}
            emphasis="hero"
            tone="amber"
          />
          <KpiCard
            title={t('newLeads')}
            value={metricsQuery.data?.newLeads ?? t('noData')}
            detail={t('dataForSelectedPeriod')}
            icon={Megaphone}
            emphasis="hero"
            tone="blue"
            isLoading={metricsQuery.isPending}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title={t('processedLeads')}
            value={metricsQuery.data?.processedLeads ?? t('noData')}
            detail={t('processedLeadsDetail')}
            icon={ClipboardCheck}
            tone="blue"
            isLoading={metricsQuery.isPending}
          />
          <KpiCard
            title={t('reachedLeads')}
            value={metricsQuery.data?.reachedLeads ?? t('noData')}
            detail={t('reachedLeadsDetail')}
            icon={PhoneCall}
            tone="green"
            isLoading={metricsQuery.isPending}
          />
          <KpiCard
            title={t('qualifiedLeads')}
            value={metricsQuery.data?.qualifiedLeads ?? t('noData')}
            detail={t('qualifiedLeadsDetail')}
            icon={BadgeCheck}
            tone="green"
            isLoading={metricsQuery.isPending}
          />
          <KpiCard
            title={t('demoBookings')}
            value={metricsQuery.data?.demoBookings ?? t('noData')}
            detail={t('demoBookingsDetail')}
            icon={CalendarCheck}
            tone="amber"
            isLoading={metricsQuery.isPending}
          />
          <KpiCard
            title={t('repeatCallLeads')}
            value={metricsQuery.data?.repeatCallLeads ?? t('noData')}
            detail={t('repeatCallLeadsDetail')}
            icon={RefreshCcw}
            tone="amber"
            isLoading={metricsQuery.isPending}
          />
          <KpiCard
            title={t('studentsForPeriod')}
            value={totalStudents}
            detail={t('dataForSelectedPeriod')}
            icon={GraduationCap}
            tone="green"
          />
          <KpiCard
            title={t('targetRefusals')}
            value={metricsQuery.data?.targetRefusals ?? t('noData')}
            detail={t('targetRefusalsDetail')}
            icon={UserX}
            tone="red"
            emphasis="risk"
            className="sm:col-span-2"
            isLoading={metricsQuery.isPending}
            onClick={() => setTargetRefusalDialogOpen(true)}
            actionLabel={t('targetRefusalReasonsTitle')}
          >
            {refusalReasonPreview.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {refusalReasonPreview.map((item) => (
                  <div key={item.reason} className="min-w-0 rounded-lg border border-border bg-card p-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium" title={archiveReasonName(item.reason)}>
                        {archiveReasonName(item.reason)}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.count} · {item.share}%
                      </span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span
                        className="block h-full rounded-full bg-destructive"
                        style={{ width: `${item.share}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </KpiCard>
        </div>
      </div>

      <Dialog open={targetRefusalDialogOpen} onOpenChange={setTargetRefusalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('targetRefusalReasonsTitle')}</DialogTitle>
            <DialogDescription>{t('targetRefusalReasonsDescription')}</DialogDescription>
          </DialogHeader>
          {metricsQuery.data?.targetRefusalReasons.length ? (
            <div className="space-y-4">
              {metricsQuery.data.targetRefusalReasons.map((item) => {
                const total = metricsQuery.data?.targetRefusals ?? 0;
                const share = total > 0 ? Math.round((item.count / total) * 100) : 0;
                return (
                  <div key={item.reason} className="space-y-2">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="min-w-0 truncate font-medium" title={archiveReasonName(item.reason)}>
                        {archiveReasonName(item.reason)}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.count} · {share}%
                      </span>
                    </div>
                    <Progress value={share} aria-label={archiveReasonName(item.reason)} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {t('targetRefusalReasonsEmpty')}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
