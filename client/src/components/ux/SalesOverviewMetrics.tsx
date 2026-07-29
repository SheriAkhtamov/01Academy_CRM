import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  BadgeCheck,
  CalendarCheck,
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
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import type { TranslationKey } from '@/lib/i18n';
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

function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'blue',
  onClick,
  actionLabel,
}: {
  title: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
  onClick?: () => void;
  actionLabel?: string;
}) {
  const toneClass = {
    blue: 'bg-primary-50 text-primary-600',
    green: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    red: 'bg-destructive/10 text-destructive',
    slate: 'bg-muted text-muted-foreground',
  }[tone];
  const card = (
    <Card className="h-full border-border/60 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="line-clamp-2 min-h-8 text-xs font-medium leading-4 text-muted-foreground" title={title}>
              {title}
            </p>
            <div className="mt-1 text-[22px] font-bold leading-tight tracking-tight tabular-nums text-foreground">
              {value}
            </div>
            {detail ? (
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground" title={detail}>
                {detail}
              </p>
            ) : null}
          </div>
          <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
            <Icon className="size-4" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!onClick) return card;

  return (
    <button
      type="button"
      className="h-full w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={onClick}
      aria-label={actionLabel ?? title}
      aria-haspopup="dialog"
    >
      {card}
    </button>
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('newLeads')}
          value={metricsQuery.data?.newLeads ?? t('noData')}
          detail={t('dataForSelectedPeriod')}
          icon={Megaphone}
          tone="blue"
        />
        <KpiCard
          title={t('processedLeads')}
          value={metricsQuery.data?.processedLeads ?? t('noData')}
          detail={t('processedLeadsDetail')}
          icon={ClipboardCheck}
          tone="blue"
        />
        <KpiCard
          title={t('reachedLeads')}
          value={metricsQuery.data?.reachedLeads ?? t('noData')}
          detail={t('reachedLeadsDetail')}
          icon={PhoneCall}
          tone="green"
        />
        <KpiCard
          title={t('qualifiedLeads')}
          value={metricsQuery.data?.qualifiedLeads ?? t('noData')}
          detail={t('qualifiedLeadsDetail')}
          icon={BadgeCheck}
          tone="green"
        />
        <KpiCard
          title={t('demoBookings')}
          value={metricsQuery.data?.demoBookings ?? t('noData')}
          detail={t('demoBookingsDetail')}
          icon={CalendarCheck}
          tone="amber"
        />
        <KpiCard
          title={t('repeatCallLeads')}
          value={metricsQuery.data?.repeatCallLeads ?? t('noData')}
          detail={t('repeatCallLeadsDetail')}
          icon={RefreshCcw}
          tone="amber"
        />
        <KpiCard
          title={t('targetRefusals')}
          value={metricsQuery.data?.targetRefusals ?? t('noData')}
          detail={t('targetRefusalsDetail')}
          icon={UserX}
          tone="red"
          onClick={() => setTargetRefusalDialogOpen(true)}
          actionLabel={t('targetRefusalReasonsTitle')}
        />
        <KpiCard
          title={isAdministrationWorkspace ? t('activeLeads') : t('activeMyLeads')}
          value={activeLeads}
          detail={t('inSalesPipeline')}
          icon={UserCheck}
          tone="amber"
        />
        <KpiCard
          title={t('studentsForPeriod')}
          value={totalStudents}
          detail={t('dataForSelectedPeriod')}
          icon={GraduationCap}
          tone="green"
        />
        <KpiCard
          title={t('conversionForPeriod')}
          value={conversionLeadCount > 0 ? `${conversionRate}%` : t('noData')}
          detail={t('paidOverAllLeads')}
          icon={Percent}
          tone={conversionLeadCount === 0
            ? 'slate'
            : conversionRate >= 30
              ? 'green'
              : conversionRate >= 15
                ? 'amber'
                : 'red'}
        />
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
