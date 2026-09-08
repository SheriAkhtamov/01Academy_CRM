import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CalendarRange } from 'lucide-react';
import { kpiMonth } from '@shared/sales-kpi-time';
import { LEAD_ARCHIVE_REASONS } from '@shared/academy';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import type { TranslationKey } from '@/lib/i18n';
import {
  isInReportingRange,
  reportingRangeQuery,
  type ReportingDateRange,
} from '@/lib/reportingDateRange';
import { OverviewDialog, overviewButton, overviewPanel } from '@/components/ux/sales-overview/OverviewDialog';
import { SalesKpiOverview, SalesCompensation } from '@/features/sales-kpi/ui/SalesKpiOverview';
import { useKpiOverview } from '@/features/sales-kpi/hooks';
import { SalesOverviewDynamics } from '@/components/ux/sales-overview/SalesOverviewDynamics';
import { SalesOverviewFunnel } from '@/components/ux/sales-overview/SalesOverviewFunnel';
import { SalesOverviewHero } from '@/components/ux/sales-overview/SalesOverviewHero';
import { SalesOverviewKpiGrid } from '@/components/ux/sales-overview/SalesOverviewKpiGrid';
import { SalesOverviewRefusals } from '@/components/ux/sales-overview/SalesOverviewRefusals';
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
  month: string;
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

export function SalesOverviewMetrics({
  month,
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
  });
  const archiveReasonName = (code: string) => {
    const key = archiveReasonTranslationKeys[code];
    return key ? t(key) : code;
  };

  const kpiQuery = useKpiOverview(month, managerId);
  const employees = kpiQuery.data?.employees ?? [];
  const metrics = metricsQuery.data;
  const isLoading = metricsQuery.isPending;
  const targetRefusals = metrics?.targetRefusals ?? 0;
  const conversionLeadCount = stats.newLeadsPeriod;

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
      {metricsQuery.isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm">
        <span className="flex items-center gap-2"><AlertCircle className="size-4" aria-hidden="true" />{t('failedToLoadData')}</span>
        <button type="button" className={overviewButton} onClick={() => metricsQuery.refetch()}>{t('retry')}</button>
      </div> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12" aria-busy={metricsQuery.isPending}>
        {isEmptyPeriod ? (
          <section className={`${overviewPanel} border-dashed bg-muted/20 xl:col-span-12`}>
            <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
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
              {month !== kpiMonth() ? <button type="button" className={`${overviewButton} shrink-0 border`} onClick={onExpandPeriod}>
                {t('salesOverviewExpandPeriod')}
              </button> : null}
            </div>
          </section>
        ) : null}

        <SalesOverviewHero
          conversionRate={stats.conversionRate}
          conversionRatePrevious={stats.conversionRatePrevious}
          showValue={conversionLeadCount > 0}
          payments={payments}
          reportingRange={reportingRange}
          previousRange={metrics?.previousRange}
          money={money}
          compensation={<SalesCompensation employees={employees} loading={kpiQuery.isPending} failed={kpiQuery.isError} isTeam={isAdministrationModule && managerId === null} />}
        />
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:col-span-12 xl:grid-cols-2">
          <SalesKpiOverview employees={employees} loading={kpiQuery.isPending} failed={kpiQuery.isError} onRetry={() => kpiQuery.refetch()} isAdministration={isAdministrationModule} />
          <SalesOverviewKpiGrid
          metrics={metrics}
          stats={stats}
          isAdministrationModule={isAdministrationModule}
          isLoading={isLoading}
          onNavigate={onNavigate}
        />

        </div>
        <SalesOverviewFunnel
          metrics={metrics}
          isLoading={isLoading}
          funnel={funnel}
          leadStatusName={leadStatusName}
          statusColor={statusColor}
        />
        <SalesOverviewDynamics metrics={metrics} isLoading={isLoading} />

        <SalesOverviewRefusals
          metrics={metrics}
          isLoading={isLoading}
          archiveReasonName={archiveReasonName}
          onOpen={() => setTargetRefusalDialogOpen(true)}
        />
      </div>

      {targetRefusalDialogOpen ? <OverviewDialog title={t('targetRefusalReasonsTitle')} description={t('targetRefusalReasonsDescription')} onClose={() => setTargetRefusalDialogOpen(false)}>
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
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {t('targetRefusalReasonsEmpty')}
            </p>
          )}
      </OverviewDialog> : null}
    </>
  );
}
