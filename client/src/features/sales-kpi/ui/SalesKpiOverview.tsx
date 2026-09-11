import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { isFullCycleKpiRole, type KpiMetric, type KpiMetricId, type KpiOverviewEmployee } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { OverviewDialog, overviewButton } from '@/components/ux/sales-overview/OverviewDialog';
import { SalesTargetBullet } from '@/components/ux/sales-overview/SalesMetricGauge';
import { metricHelp, metricKeys } from '../copy';
import { KpiMetricsGrid, KpiMetricRow } from './KpiMetricsGrid';
import { KpiMetricDetails } from './KpiMetricDetails';
import { KpiSaleReviewDialog } from './KpiSaleReviewDialog';

function EmployeeDetails({ employee, periodLabel, onClose }: { employee: KpiOverviewEmployee; periodLabel: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<KpiMetric | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  if (reviewOpen) return <KpiSaleReviewDialog sales={employee.calculation.reviewableSales} onClose={() => setReviewOpen(false)} />;
  return <>
    <OverviewDialog title={t('salesEmployeeResult').replace('{name}', employee.name)} description={periodLabel} onClose={onClose}>
      <KpiMetricsGrid metrics={employee.calculation.metrics} onSelect={setMetric} />
      {employee.calculation.reviewableSales.length ? <button type="button" className={`${overviewButton} border`} onClick={() => setReviewOpen(true)}>{t('kpiSalesReview')}</button> : null}
    </OverviewDialog>
    {metric ? <KpiMetricDetails metric={metric} help={metricHelp(metric.id, employee.version.config, t)} onClose={() => setMetric(null)} /> : null}
  </>;
}

export function SalesKpiOverview({ month, employees, loading, failed, onRetry }: {
  month: string; employees: KpiOverviewEmployee[]; loading: boolean; failed: boolean; onRetry: () => void;
}) {
  const { t, language } = useTranslation();
  const monthLabel = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const periodLabel = t('salesMonthPlanPeriod').replace('{month}', monthLabel);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [metric, setMetric] = useState<KpiMetric | null>(null);
  const employee = employees.length === 1 ? employees[0] : null;
  const selected = employees.find((item) => item.id === selectedId);
  const primaryIds: KpiMetricId[] = employee?.role === 'hunter' ? ['bookings', 'attendance', 'response']
    : isFullCycleKpiRole(employee?.role) ? ['bookings', 'attendance', 'newStudents']
      : ['newStudents', 'trialConversion', 'renewalConversion'];
  const primary = primaryIds.flatMap((id) => employee?.calculation.metrics.find((item) => item.id === id) ?? []);
  if (!loading && !failed && !employees.length) return null;
  return <section className="min-w-0 border-b border-border/60 py-7 xl:col-span-12" aria-label={t('salesMonthPlan')}>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold">{t('salesMonthPlan')}</h2><p className="mt-1 text-xs text-muted-foreground">{periodLabel}</p></div>
      {employee ? <button type="button" className={`${overviewButton} text-xs text-muted-foreground`} onClick={() => setSelectedId(employee.id)}>{t('salesAllMetrics')}<ArrowUpRight className="size-3.5" aria-hidden="true" /></button> : null}
    </header>
    {loading ? <div className="my-3 h-14 animate-pulse rounded bg-muted" aria-busy="true" />
      : failed ? <div className="flex items-center justify-between gap-3 py-2" role="alert"><p className="text-sm text-muted-foreground">{t('failedToLoadData')}</p><button type="button" className={overviewButton} onClick={onRetry}>{t('retry')}</button></div>
        : employee ? <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">{primary.map((item) => <KpiMetricRow key={item.id} metric={item} onSelect={setMetric} compact />)}</div>
          : <div className="divide-y divide-border/60">{employees.map((item) => {
            const result = item.calculation.metrics.find((entry) => entry.id === (item.role === 'hunter' ? 'bookings' : 'newStudents'));
            return <button type="button" key={item.id} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedId(item.id)} aria-haspopup="dialog">
              <span className="text-sm font-medium">{item.name}</span>
              {result ? <span className="w-full max-w-sm text-xs text-muted-foreground"><span className="flex items-center justify-between gap-3">{t(metricKeys[result.id])}<span className="text-sm font-semibold tabular-nums text-foreground">{result.value ?? '—'} / {result.target ?? '—'}</span><ArrowUpRight className="size-3.5" aria-hidden="true" /></span>{result.target !== null ? <SalesTargetBullet value={result.value} target={result.target} label={`${t('kpiPlanFact')}: ${result.value ?? '—'} / ${result.target}`} className="mt-1 text-blue-500 dark:text-blue-400" /> : null}</span> : null}
            </button>;
          })}</div>}
    {selected ? <EmployeeDetails employee={selected} periodLabel={periodLabel} onClose={() => setSelectedId(null)} /> : null}
    {metric && employee ? <KpiMetricDetails metric={metric} help={metricHelp(metric.id, employee.version.config, t)} onClose={() => setMetric(null)} /> : null}
  </section>;
}
