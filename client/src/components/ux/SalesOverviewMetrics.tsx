import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CalendarRange } from 'lucide-react';
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
  isInReportingRange,
  reportingRangeQuery,
  type ReportingDateRange,
} from '@/lib/reportingDateRange';
import { SectionHeading } from '@/components/ux/sales-overview/parts';
import { SalesOverviewDynamics } from '@/components/ux/sales-overview/SalesOverviewDynamics';
import { SalesOverviewFunnel } from '@/components/ux/sales-overview/SalesOverviewFunnel';
import { SalesOverviewHero } from '@/components/ux/sales-overview/SalesOverviewHero';
import { SalesOverviewKpiGrid } from '@/components/ux/sales-overview/SalesOverviewKpiGrid';
import { SalesOverviewRefusals } from '@/components/ux/sales-overview/SalesOverviewRefusals';
import { SalesOverviewStructure } from '@/components/ux/sales-overview/SalesOverviewStructure';
import type {
  MoneyFormatter,
  SalesDashboardMetrics,
  SalesOverviewFunnelStage,
  SalesOverviewNavTarget,
  SalesOverviewStats,
} from '@/components/ux/sales-overview/types';

type PaymentRecord = {
  amountUzs?: number | string | null;
  method?: string | null;
  status?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
};

type SalesOverviewMetricsProps = {
  reportingRange: Pick<ReportingDateRange, 'from' | 'to'>;
  managerId: number | null;
  isAdministrationModule: boolean;
  stats: SalesOverviewStats;
  /** Every payment in scope; the hero windows them itself. */
  payments: PaymentRecord[];
  funnel: SalesOverviewFunnelStage[];
  leadStatusName: (code: string) => string;
  statusColor: (code: string) => string;
  money: MoneyFormatter;
  onNavigate: (target: SalesOverviewNavTarget) => void;
  onExpandPeriod: () => void;
};

const archiveReasonTranslationKeys = Object.fromEntries(
  LEAD_ARCHIVE_REASONS.map((reason) => [reason.code, reason.translationKey]),
) as Record<string, TranslationKey>;

/**
 * The sales overview, arranged as three named bands rather than a wall of
 * equally weighted cards: what the period produced, how leads flowed through
 * it, and the breakdown behind those two.
 *
 * This component stays the orchestrator — it owns the single metrics request
 * and the refusal dialog — while each band is its own file under
 * `sales-overview/`.
 */
export function SalesOverviewMetrics({
  reportingRange,
  managerId,
  isAdministrationModule,
  stats,
  payments,
  funnel,
  leadStatusName,
  statusColor,
  money,
  onNavigate,
  onExpandPeriod,
}: SalesOverviewMetricsProps) {
  const { t } = useTranslation();
  const [targetRefusalDialogOpen, setTargetRefusalDialogOpen] = useState(false);
  const reportingQuery = reportingRangeQuery(reportingRange);
  const metricsQueryString = managerId
    ? `${reportingQuery}&managerId=${managerId}`
    : reportingQuery;
  const metricsQuery = useQuery<SalesDashboardMetrics>({
    queryKey: ['/api/academy/modules/sales/metrics', reportingQuery, managerId],
    queryFn: () => apiRequest('GET', `/api/academy/modules/sales/metrics?${metricsQueryString}`),
    // A date change may keep the last figures visible, but switching employees
    // must never briefly label one person's numbers as another person's.
    placeholderData: (previousData, previousQuery) => (
      previousQuery?.queryKey[2] === managerId ? previousData : undefined
    ),
  });
  const archiveReasonName = (code: string) => {
    const key = archiveReasonTranslationKeys[code];
    return key ? t(key) : code;
  };

  const metrics = metricsQuery.data;
  const isLoading = metricsQuery.isPending;
  const targetRefusals = metrics?.targetRefusals ?? 0;
  const conversionLeadCount = stats.newLeadsPeriod;

  // "Today" on a quiet morning used to render every card as a zero, which is
  // indistinguishable from a broken screen. Say so plainly instead, and offer
  // the way out in one click.
  const hasPeriodPayments = payments.some((payment) => (
    payment.status === 'paid' && isInReportingRange(payment.paidAt || payment.createdAt, reportingRange)
  ));
  const isEmptyPeriod = !isLoading
    && metrics !== undefined
    && metrics.newLeads === 0
    && metrics.processedLeads === 0
    && conversionLeadCount === 0
    && stats.totalStudents === 0
    && !hasPeriodPayments;

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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12" aria-busy={metricsQuery.isPending}>
        {isEmptyPeriod ? (
          <Card className="border-dashed border-border bg-muted/30 shadow-none xl:col-span-12">
            <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <CalendarRange className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t('salesOverviewEmptyTitle')}</p>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                    {t('salesOverviewEmptyDescription')}
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onExpandPeriod}>
                {t('salesOverviewExpandPeriod')}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <SectionHeading title={t('salesOverviewResultTitle')} />
        <SalesOverviewHero
          conversionRate={stats.conversionRate}
          conversionRatePrevious={stats.conversionRatePrevious}
          showValue={conversionLeadCount > 0}
          payments={payments}
          reportingRange={reportingRange}
          previousRange={metrics?.previousRange}
          money={money}
        />
        <SalesOverviewKpiGrid
          metrics={metrics}
          stats={stats}
          isAdministrationModule={isAdministrationModule}
          isLoading={isLoading}
          onNavigate={onNavigate}
        />

        <SectionHeading title={t('salesOverviewFlowTitle')} />
        <SalesOverviewFunnel
          metrics={metrics}
          isLoading={isLoading}
          funnel={funnel}
          leadStatusName={leadStatusName}
          statusColor={statusColor}
        />
        <SalesOverviewDynamics metrics={metrics} isLoading={isLoading} />

        <SectionHeading title={t('salesOverviewBreakdownTitle')} />
        <SalesOverviewStructure
          metrics={metrics}
          totalStudents={stats.totalStudents}
          isLoading={isLoading}
        />
        <SalesOverviewRefusals
          metrics={metrics}
          isLoading={isLoading}
          archiveReasonName={archiveReasonName}
          onOpen={() => setTargetRefusalDialogOpen(true)}
        />
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
