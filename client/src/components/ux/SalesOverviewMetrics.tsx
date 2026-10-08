import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CalendarRange } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import {
  isInReportingRange,
  reportingRangeQuery,
  reportingRangeForPreset,
  type ReportingDateRange,
} from '@/lib/reportingDateRange';
import { overviewButton, overviewPanel } from '@/components/ux/sales-overview/OverviewDialog';
import { DemoStudentsDialog } from '@/components/ux/sales-overview/DemoStudentsDialog';
import { SalesKpiOverview } from '@/features/sales-kpi/ui/SalesKpiOverview';
import { useKpiOverview } from '@/features/sales-kpi/hooks';
import { SalesOverviewFunnel } from '@/components/ux/sales-overview/SalesOverviewFunnel';
import { SalesOverviewHero } from '@/components/ux/sales-overview/SalesOverviewHero';
import { SalesOverviewKpiGrid } from '@/components/ux/sales-overview/SalesOverviewKpiGrid';
import type {
  MoneyFormatter,
  SalesDashboardMetrics,
  SalesOverviewNavTarget,
  SalesOverviewStats,
  SalesOverviewStudent,
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
  stats: SalesOverviewStats;
  /** Every payment in scope; the hero windows them itself. */
  payments: PaymentRecord[];
  students: SalesOverviewStudent[];
  money: MoneyFormatter;
  onNavigate: (target: SalesOverviewNavTarget) => void;
  onExpandPeriod: () => void;
  onOpenLead?: (leadId: number) => void;
};

export function SalesOverviewMetrics({
  month,
  reportingRange,
  managerId,
  stats,
  payments,
  students,
  money,
  onNavigate,
  onExpandPeriod,
  onOpenLead,
}: SalesOverviewMetricsProps) {
  const { t } = useTranslation();
  const [demoStudentsDialogOpen, setDemoStudentsDialogOpen] = useState(false);
  const reportingQuery = reportingRangeQuery(reportingRange);
  const metricsQueryString = managerId
    ? `${reportingQuery}&managerId=${managerId}`
    : reportingQuery;
  const metricsQuery = useQuery<SalesDashboardMetrics>({
    queryKey: ['/api/academy/modules/sales/metrics', reportingQuery, managerId],
    queryFn: () => apiRequest('GET', `/api/academy/modules/sales/metrics?${metricsQueryString}`),
  });
  const kpiQuery = useKpiOverview(month, managerId);
  const employees = kpiQuery.data?.employees ?? [];
  const metrics = metricsQuery.data;
  const isLoading = metricsQuery.isPending;
  const thisMonth = reportingRangeForPreset('thisMonth');

  const hasPeriodPayments = payments.some((payment) => (
    payment.status === 'paid' && isInReportingRange(payment.paidAt || payment.createdAt, reportingRange)
  ));
  const isEmptyPeriod = !isLoading
    && metrics !== undefined
    && metrics.newLeads === 0
    && metrics.processedLeads === 0
    && metrics.demoAttendees === 0
    && stats.newLeadsPeriod === 0
    && stats.totalStudents === 0
    && !hasPeriodPayments;

  return (
    <>
      {metricsQuery.isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm">
        <span className="flex items-center gap-2"><AlertCircle className="size-4" aria-hidden="true" />{t('failedToLoadData')}</span>
        <button type="button" className={overviewButton} onClick={() => metricsQuery.refetch()}>{t('retry')}</button>
      </div> : null}

      <div className="grid grid-cols-1 rounded-2xl bg-card px-5 py-7 text-card-foreground sm:px-8 xl:grid-cols-12 xl:px-10" aria-busy={metricsQuery.isPending}>
        {isEmptyPeriod ? (
          <section className={`${overviewPanel} border-dashed bg-muted/20 xl:col-span-12`}>
            <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <CalendarRange className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t('salesOverviewEmptyTitle')}</p>

                </div>
              </div>
              {reportingRange.from !== thisMonth.from || reportingRange.to !== thisMonth.to ? <button type="button" className={`${overviewButton} shrink-0 border`} onClick={onExpandPeriod}>
                {t('salesOverviewExpandPeriod')}
              </button> : null}
            </div>
          </section>
        ) : null}

        <SalesOverviewHero stats={stats} metrics={metrics} payments={payments} students={students} reportingRange={reportingRange} previousRange={metrics?.previousRange} money={money} />
        <SalesOverviewKpiGrid
          metrics={metrics}
          stats={stats}
          payments={payments}
          reportingRange={reportingRange}
          onNavigate={onNavigate}
          onOpenDemoStudents={() => setDemoStudentsDialogOpen(true)}
        />
        <SalesKpiOverview month={month} employees={employees} loading={kpiQuery.isPending} failed={kpiQuery.isError} onRetry={() => kpiQuery.refetch()} />
        <SalesOverviewFunnel
          metrics={metrics}
          isLoading={isLoading}
        />

      </div>

      {demoStudentsDialogOpen ? (
        <DemoStudentsDialog key={`${reportingQuery}-${managerId}`}
          reportingRange={reportingRange}
          managerId={managerId}
          onClose={() => setDemoStudentsDialogOpen(false)}
          onOpenLead={onOpenLead}
        />
      ) : null}
    </>
  );
}
