import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, CircleDashed, Target, TriangleAlert, Wallet } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';
import type { KpiMetric, KpiOverviewEmployee } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { OverviewDialog, overviewButton, overviewPanel } from '@/components/ux/sales-overview/OverviewDialog';
import { kpiMoney, metricHelp, metricKeys, roleKeys } from '../copy';
import { KpiMetricsGrid, KpiMetricRow } from './KpiMetricsGrid';
import { KpiMetricDetails } from './KpiMetricDetails';
import { KpiPayTable } from './KpiPayTable';
import { KpiSaleReviewDialog } from './KpiSaleReviewDialog';

export function SalesCompensation({ employees, loading, failed, isTeam }: {
  employees: KpiOverviewEmployee[]; loading: boolean; failed: boolean; isTeam: boolean;
}) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(false);
  const total = employees.reduce((sum, employee) => sum + employee.calculation.totalUzs, 0);
  const base = employees.reduce((sum, employee) => sum + employee.calculation.payLines.filter((line) => line.key === 'base').reduce((amount, line) => amount + line.amountUzs, 0), 0);
  return <>
    <button type="button" className={`${overviewPanel} group flex h-full flex-col p-5 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6`}
      onClick={() => setOpen(true)} disabled={loading || failed || !employees.length} aria-haspopup="dialog" aria-label={t('salesRewardDetails')}>
      <span className="flex w-full items-center justify-between gap-2 text-sm font-medium text-muted-foreground"><span>{isTeam ? t('salesRewardTeam') : t('salesReward')}</span><Wallet className="size-4" aria-hidden="true" /></span>
      {loading ? <span className="mt-4 h-9 w-3/4 animate-pulse rounded bg-muted" /> : <span className="mt-3 break-words text-[clamp(1.25rem,1.8vw,1.875rem)] font-semibold tracking-tight tabular-nums">{failed || !employees.length ? '—' : kpiMoney(total, language)}</span>}
      <span className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('salesSalaryAndBonus')}</span>
      <span className="mt-auto flex items-center gap-1 pt-4 text-xs font-medium text-primary">{!loading && !failed && !employees.length ? t('kpiNotAssigned') : t('kpiPayBreakdown')}<ArrowUpRight className="size-3.5" aria-hidden="true" /></span>
    </button>
    {open ? <OverviewDialog title={t('salesRewardDetails')} description={t('kpiPayBreakdownHint')} onClose={() => setOpen(false)}>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{kpiMoney(total, language)}</p>
      <p className="text-sm text-muted-foreground">{t('salesRewardSummary').replace('{base}', kpiMoney(base, language)).replace('{bonus}', kpiMoney(total - base, language))}</p>
      <p className="text-sm text-muted-foreground">{t('kpiPreviewHint')}</p>
      {employees.map((employee) => <section key={employee.id} className="space-y-3"><h3 className="font-medium">{employee.name} <span className="ml-2 text-xs text-muted-foreground">{t(roleKeys[employee.role])}</span></h3><KpiPayTable lines={employee.calculation.payLines} /></section>)}
    </OverviewDialog> : null}
  </>;
}

function EmployeeDetails({ employee, onClose }: { employee: KpiOverviewEmployee; onClose: () => void }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<KpiMetric | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { calculation, version } = employee;
  const conditions = [
    { translationKey: 'kpiBaseVolumeCondition', value: calculation.baseConditions.volume },
    { translationKey: 'kpiBaseCrmCondition', value: calculation.baseConditions.crm },
    { translationKey: 'kpiBaseTimingCondition', value: calculation.baseConditions.timing },
  ] satisfies { translationKey: TranslationKey; value: boolean | null }[];
  // Return to the employee details when payment review closes.
  if (reviewOpen) return <KpiSaleReviewDialog sales={calculation.reviewableSales} onClose={() => setReviewOpen(false)} />;
  return <>
    <OverviewDialog title={t('salesEmployeeResult').replace('{name}', employee.name)} description={t(roleKeys[employee.role])} onClose={onClose}>
      <KpiMetricsGrid metrics={calculation.metrics} onSelect={setMetric} />
      {calculation.reviewableSales.length ? <button type="button" className={`${overviewButton} border`} onClick={() => setReviewOpen(true)}>{t('kpiSalesReview')}{calculation.unclassifiedSales.length ? <span className="rounded bg-amber-500/10 px-2 text-amber-700 dark:text-amber-400">{calculation.unclassifiedSales.length}</span> : null}</button> : null}
      <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">{t('kpiBaseConditions')}</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{conditions.map(({ translationKey, value }) => <span key={translationKey} className="flex items-center gap-2 text-xs text-muted-foreground">
          {value === true ? <CheckCircle2 className="size-4 text-emerald-600" aria-label={t('kpiEarned')} /> : value === false ? <TriangleAlert className="size-4 text-amber-600" aria-label={t('kpiNotMet')} /> : <CircleDashed className="size-4" aria-label={t('kpiPending')} />}{t(translationKey)}
        </span>)}</div>
        <p className="text-xs text-muted-foreground">{version.config.baseSalaryMode === 'guaranteed' ? t('kpiGuaranteed') : t('kpiConditional')}</p>
        <p className="text-xs text-muted-foreground">{t('kpiVersion').replace('{version}', String(version.id)).replace('{month}', version.effectiveMonth)}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('kpiTrackingHint')}</p>
      </section>
    </OverviewDialog>
    {metric ? <KpiMetricDetails metric={metric} help={metricHelp(metric.id, version.config, t)} onClose={() => setMetric(null)} /> : null}
  </>;
}

export function SalesKpiOverview({ employees, loading, failed, onRetry, isAdministration }: {
  employees: KpiOverviewEmployee[]; loading: boolean; failed: boolean; onRetry: () => void; isAdministration: boolean;
}) {
  const { t, language } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [metric, setMetric] = useState<KpiMetric | null>(null);
  const employee = employees.length === 1 ? employees[0] : null;
  const selected = employees.find((item) => item.id === selectedId);
  const primaryIds = employee?.role === 'hunter' ? ['bookings', 'attendance', 'response'] : ['newStudents', 'trialConversion', 'renewalConversion'];
  const primary = employee?.calculation.metrics.filter((item) => primaryIds.includes(item.id)) ?? [];
  return <section className={`${overviewPanel} p-3 sm:p-4`} aria-label={t('salesResultsPlan')}>
    <header className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
      <h2 className="text-base font-semibold tracking-tight">{t('salesResultsPlan')}</h2>
      {employee ? <button type="button" className={`${overviewButton} text-primary`} onClick={() => setSelectedId(employee.id)}>{t('salesAllMetrics')}<ArrowUpRight className="size-4" aria-hidden="true" /></button> : null}
    </header>
    {loading ? <div className="space-y-4 p-3" aria-busy="true">{[0, 1, 2].map((id) => <div key={id} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>
      : failed ? <div className="space-y-3 p-3" role="alert"><p className="text-sm text-muted-foreground">{t('failedToLoadData')}</p><button type="button" className={`${overviewButton} border`} onClick={onRetry}>{t('retry')}</button></div>
        : employee ? <>
          <p className="px-3 pb-2 text-xs text-muted-foreground">{employee.name} · {t(roleKeys[employee.role])}</p>
          <div className="divide-y divide-border/60">{primary.map((item) => <KpiMetricRow key={item.id} metric={item} onSelect={setMetric} />)}</div>
          {employee.calculation.unclassifiedSales.length ? <button type="button" className={`${overviewButton} mt-2 w-full justify-start text-amber-700 dark:text-amber-400`} onClick={() => setSelectedId(employee.id)}><TriangleAlert className="size-4 shrink-0" aria-hidden="true" />{t('salesBonusReview').replace('{count}', String(employee.calculation.unclassifiedSales.length))}</button> : null}
        </> : employees.length ? <div className="max-h-96 overflow-auto" aria-label={t('salesTeamResults')}>
          {employees.map((item) => {
            const result = item.calculation.metrics.find((entry) => entry.id === (item.role === 'hunter' ? 'bookings' : 'newStudents'));
            return <button type="button" key={item.id} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border-b border-border/50 p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedId(item.id)} aria-haspopup="dialog">
              <span className="min-w-0"><span className="block text-sm font-medium">{item.name}</span><span className="mt-1 block text-xs text-muted-foreground">{t(roleKeys[item.role])}{result ? ` · ${t(metricKeys[result.id])}: ${result.value ?? '—'} / ${result.target ?? '—'}` : ''}</span></span>
              <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">{kpiMoney(item.calculation.totalUzs, language)}<ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" /></span>
            </button>;
          })}
        </div> : <div className="flex min-h-56 flex-col items-start justify-center gap-3 px-3 py-6"><Target className="size-6 text-muted-foreground" aria-hidden="true" /><h3 className="text-sm font-medium">{t('kpiNoSystemTitle')}</h3><p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t('salesNoAssignmentHint')}</p><p className="text-xs text-muted-foreground">{isAdministration ? t('kpiNoSystemDescription') : t('kpiNoSystemSelf')}</p></div>}
    {selected ? <EmployeeDetails employee={selected} onClose={() => setSelectedId(null)} /> : null}
    {metric && employee ? <KpiMetricDetails metric={metric} help={metricHelp(metric.id, employee.version.config, t)} onClose={() => setMetric(null)} /> : null}
  </section>;
}
