import { useState } from 'react';
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
  isAdministrationModule: boolean;
  activeLeads: number;
  totalStudents: number;
  conversionLeadCount: number;
  conversionRate: number;
};

const archiveReasonTranslationKeys = Object.fromEntries(
  LEAD_ARCHIVE_REASONS.map((reason) => [reason.code, reason.translationKey]),
) as Record<string, TranslationKey>;

type Tone = 'primary' | 'emerald' | 'amber' | 'red' | 'slate';

const TONE_ICON: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  slate: 'bg-muted text-muted-foreground',
};

const TONE_BAR: Record<Tone, string> = {
  primary: 'bg-primary',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  slate: 'bg-muted-foreground/40',
};

const TONE_RING: Record<Tone, string> = {
  primary: 'stroke-primary',
  emerald: 'stroke-emerald-500',
  amber: 'stroke-amber-500',
  red: 'stroke-red-500',
  slate: 'stroke-muted-foreground/40',
};

function conversionTone(conversionLeadCount: number, conversionRate: number): Tone {
  if (conversionLeadCount === 0) return 'slate';
  if (conversionRate >= 30) return 'emerald';
  if (conversionRate >= 15) return 'amber';
  return 'red';
}

function ConversionRing({ percent, tone }: { percent: number | null; tone: Tone }) {
  const size = 104;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
          className={cn('transition-[stroke-dashoffset] duration-700 ease-out', TONE_RING[tone])}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold tabular-nums text-foreground">
          {percent === null ? '—' : `${percent}%`}
        </span>
      </div>
    </div>
  );
}

function HeroCard({
  title,
  hint,
  icon: Icon,
  tone,
  isLoading = false,
  value,
  children,
}: {
  title: string;
  hint: string;
  icon: LucideIcon;
  tone: Tone;
  isLoading?: boolean;
  value?: string | number;
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md">
      <CardContent className="flex h-full items-center gap-4 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <p className="truncate text-sm font-medium text-muted-foreground" title={title}>
              {title}
            </p>
          </div>
          <div className="mt-3">
            {isLoading ? (
              <Skeleton className="h-9 w-24 rounded-md" />
            ) : value !== undefined ? (
              <div className="text-[32px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                {value}
              </div>
            ) : null}
          </div>
          <p className="mt-1.5 truncate text-xs text-muted-foreground" title={hint}>
            {hint}
          </p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function MetricCard({
  title,
  hint,
  value,
  icon: Icon,
  tone,
  share = null,
  isLoading = false,
  onClick,
  actionLabel,
  className,
  children,
}: {
  title: string;
  hint: string;
  value: string | number;
  icon: LucideIcon;
  tone: Tone;
  share?: number | null;
  isLoading?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const content = (
    <Card
      className={cn(
        'h-full border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md',
        onClick && 'text-left',
      )}
    >
      <CardContent className="flex h-full flex-col p-4">
        <div className="flex items-center gap-2">
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground" title={title}>
            {title}
          </p>
          {onClick ? (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>
        <div className="mt-3">
          {isLoading ? (
            <Skeleton className="h-8 w-20 rounded-md" />
          ) : (
            <div className="text-[26px] font-bold leading-none tracking-tight tabular-nums text-foreground">
              {value}
            </div>
          )}
        </div>
        {share !== null && !isLoading ? (
          <div className="mt-3 flex items-center gap-2">
            <div
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={share}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${title}: ${share}%`}
            >
              <span
                className={cn('block h-full rounded-full', TONE_BAR[tone])}
                style={{ width: `${share}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
              {share}%
            </span>
          </div>
        ) : (
          <p className="mt-3 truncate text-xs text-muted-foreground" title={hint}>
            {hint}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );

  if (!onClick) return <div className={className}>{content}</div>;

  return (
    <button
      type="button"
      className={cn(
        'h-full w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      onClick={onClick}
      aria-label={actionLabel ?? title}
      aria-haspopup="dialog"
    >
      {content}
    </button>
  );
}

function shareOf(part: number | undefined, total: number | undefined): number | null {
  if (!total || total <= 0 || part === undefined) return null;
  return Math.min(100, Math.round((part / total) * 100));
}

export function SalesOverviewMetrics({
  reportingRange,
  isAdministrationModule,
  activeLeads,
  totalStudents,
  conversionLeadCount,
  conversionRate,
}: SalesOverviewMetricsProps) {
  const { t } = useTranslation();
  const [targetRefusalDialogOpen, setTargetRefusalDialogOpen] = useState(false);
  const reportingQuery = reportingRangeQuery(reportingRange);
  const metricsQuery = useQuery<SalesDashboardMetrics>({
    queryKey: ['/api/academy/modules/sales/metrics', reportingQuery],
    queryFn: () => apiRequest('GET', `/api/academy/modules/sales/metrics?${reportingQuery}`),
    placeholderData: (previousData) => previousData,
  });
  const archiveReasonName = (code: string) => {
    const key = archiveReasonTranslationKeys[code];
    return key ? t(key) : code;
  };

  const metrics = metricsQuery.data;
  const isLoading = metricsQuery.isPending;
  const newLeads = metrics?.newLeads;
  const targetRefusals = metrics?.targetRefusals ?? 0;
  const refusalReasonPreview = (metrics?.targetRefusalReasons ?? [])
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
          <HeroCard
            title={t('conversionForPeriod')}
            hint={t('paidOverAllLeads')}
            icon={Percent}
            tone={conversionTone(conversionLeadCount, conversionRate)}
          >
            <ConversionRing
              percent={conversionLeadCount > 0 ? conversionRate : null}
              tone={conversionTone(conversionLeadCount, conversionRate)}
            />
          </HeroCard>
          <HeroCard
            title={t('newLeads')}
            hint={t('dataForSelectedPeriod')}
            icon={Megaphone}
            tone="primary"
            isLoading={isLoading}
            value={newLeads ?? 0}
          />
          <HeroCard
            title={isAdministrationModule ? t('activeLeads') : t('activeMyLeads')}
            hint={t('inSalesPipeline')}
            icon={UserCheck}
            tone="amber"
            value={activeLeads}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label={t('periodMetricsGroup')}>
          <MetricCard
            title={t('processedLeads')}
            hint={t('processedLeadsDetail')}
            value={metrics?.processedLeads ?? 0}
            icon={ClipboardCheck}
            tone="primary"
            share={shareOf(metrics?.processedLeads, newLeads)}
            isLoading={isLoading}
          />
          <MetricCard
            title={t('reachedLeads')}
            hint={t('reachedLeadsDetail')}
            value={metrics?.reachedLeads ?? 0}
            icon={PhoneCall}
            tone="emerald"
            share={shareOf(metrics?.reachedLeads, newLeads)}
            isLoading={isLoading}
          />
          <MetricCard
            title={t('qualifiedLeads')}
            hint={t('qualifiedLeadsDetail')}
            value={metrics?.qualifiedLeads ?? 0}
            icon={BadgeCheck}
            tone="emerald"
            share={shareOf(metrics?.qualifiedLeads, newLeads)}
            isLoading={isLoading}
          />
          <MetricCard
            title={t('demoBookings')}
            hint={t('demoBookingsDetail')}
            value={metrics?.demoBookings ?? 0}
            icon={CalendarCheck}
            tone="amber"
            share={shareOf(metrics?.demoBookings, newLeads)}
            isLoading={isLoading}
          />
          <MetricCard
            title={t('repeatCallLeads')}
            hint={t('repeatCallLeadsDetail')}
            value={metrics?.repeatCallLeads ?? 0}
            icon={RefreshCcw}
            tone="amber"
            share={shareOf(metrics?.repeatCallLeads, newLeads)}
            isLoading={isLoading}
          />
          <MetricCard
            title={t('studentsForPeriod')}
            hint={t('dataForSelectedPeriod')}
            value={totalStudents}
            icon={GraduationCap}
            tone="emerald"
          />
          <MetricCard
            title={t('targetRefusals')}
            hint={t('targetRefusalsDetail')}
            value={targetRefusals}
            icon={UserX}
            tone="red"
            isLoading={isLoading}
            onClick={() => setTargetRefusalDialogOpen(true)}
            actionLabel={t('targetRefusalReasonsTitle')}
            className="sm:col-span-2 xl:col-span-3"
          >
            {refusalReasonPreview.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {refusalReasonPreview.map((item) => (
                  <div key={item.reason} className="min-w-0 rounded-lg border border-border/60 bg-muted/30 p-2.5">
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
                        className="block h-full rounded-full bg-red-500"
                        style={{ width: `${item.share}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </MetricCard>
        </div>
      </div>

      <Dialog open={targetRefusalDialogOpen} onOpenChange={setTargetRefusalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('targetRefusalReasonsTitle')}</DialogTitle>
            <DialogDescription>{t('targetRefusalReasonsDescription')}</DialogDescription>
          </DialogHeader>
          {metrics?.targetRefusalReasons.length ? (
            <div className="space-y-4">
              {metrics.targetRefusalReasons.map((item) => {
                const share = targetRefusals > 0 ? Math.round((item.count / targetRefusals) * 100) : 0;
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
