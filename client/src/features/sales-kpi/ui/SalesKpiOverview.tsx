import { useState } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import { ArrowUpRight, CalendarDays, CheckCircle2, CircleDashed, ReceiptText, Target, TriangleAlert } from 'lucide-react';
import { kpiMonth, kpiMonthBounds } from '@shared/sales-kpi-time';
import { kpiMonthSchema, type KpiMetricId, type KpiOverviewEmployee } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useKpiOverview } from '../hooks';
import { kpiMoney, metricHelp, roleKeys } from '../copy';
import { KpiMetricsGrid } from './KpiMetricsGrid';
import { KpiMetricDetails } from './KpiMetricDetails';
import { KpiPayTable } from './KpiPayTable';
import { KpiSaleReviewDialog } from './KpiSaleReviewDialog';

function EmployeeOverview({ employee, month }: { employee: KpiOverviewEmployee; month: string }) {
  const { t, language } = useTranslation();
  const [metricId, setMetricId] = useState<KpiMetricId | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { calculation, version } = employee;
  const selectedMetric = calculation.metrics.find((metric) => metric.id === metricId);
  const monthLabel = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' }).format(kpiMonthBounds(month).start);
  const conditions = [
    { translationKey: 'kpiBaseVolumeCondition', value: calculation.baseConditions.volume },
    { translationKey: 'kpiBaseCrmCondition', value: calculation.baseConditions.crm },
    { translationKey: 'kpiBaseTimingCondition', value: calculation.baseConditions.timing },
  ] satisfies { translationKey: TranslationKey; value: boolean | null }[];
  return <section className="space-y-4" aria-label={`${employee.name} · ${t(roleKeys[employee.role])}`}>
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2"><Badge className="font-medium" variant="secondary">{t(roleKeys[employee.role])}</Badge><span className="text-xs capitalize text-muted-foreground">{monthLabel}</span></div>
            <h3 className="text-2xl font-semibold tracking-tight">{employee.name}</h3>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{(employee.role === 'hunter' ? t('kpiHunterDescription') : t('kpiCloserDescription'))}</p>
            <p className="text-xs text-muted-foreground">{t('kpiVersion').replace('{version}', String(version.id)).replace('{month}', version.effectiveMonth)}</p>
          </div>
          <div className="flex flex-col justify-center border-t bg-muted/25 p-5 sm:p-6 lg:border-l lg:border-t-0">
            <p className="text-xs font-medium text-muted-foreground">{t('kpiPreviewTotal')}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{kpiMoney(calculation.totalUzs, language)}</p>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">{t('kpiPreviewHint')}</p>
            <Button variant="outline" className="mt-4 w-fit gap-2 bg-background" onClick={() => setPayOpen(true)}><ReceiptText className="size-4" />{t('kpiPayBreakdown')}<ArrowUpRight className="size-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
    <KpiMetricsGrid metrics={calculation.metrics} onSelect={(metric) => setMetricId(metric.id)} />
    <div className="rounded-xl border bg-muted/10 p-4">
      <p className="text-sm font-medium">{t('kpiBaseConditions')}</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">{conditions.map(({ translationKey, value }) => <span key={translationKey} className="flex items-center gap-2 text-xs text-muted-foreground">
        {value === true ? <CheckCircle2 className="size-4 text-emerald-600" aria-label={t('kpiEarned')} /> : value === false ? <TriangleAlert className="size-4 text-amber-600" aria-label={t('kpiNotMet')} /> : <CircleDashed className="size-4" aria-label={t('kpiPending')} />}{t(translationKey)}
      </span>)}</div>
      <p className="mt-3 text-xs text-muted-foreground">{(version.config.baseSalaryMode === 'guaranteed' ? t('kpiGuaranteed') : t('kpiConditional'))}</p>
    </div>
    {calculation.unclassifiedSales.length ? <Alert className="border-amber-500/30 bg-amber-500/5"><TriangleAlert className="size-4 text-amber-600" /><AlertTitle>{t('kpiUnclassifiedTitle').replace('{count}', String(calculation.unclassifiedSales.length))}</AlertTitle><AlertDescription>
      <p>{t('kpiUnclassifiedDescription')}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setReviewOpen(true)}>{t('kpiSalesReview')}</Button>
    </AlertDescription></Alert> : calculation.reviewableSales.length ? <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)}>{t('kpiSalesReview')}</Button> : null}
    {selectedMetric ? <KpiMetricDetails key={selectedMetric.id} metric={selectedMetric} help={metricHelp(selectedMetric.id, version.config, t)} onClose={() => setMetricId(null)} /> : null}
    <Dialog open={payOpen} onOpenChange={setPayOpen}><DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>{t('kpiPayBreakdown')} · {employee.name}</DialogTitle><DialogDescription>{t('kpiPayBreakdownHint')}</DialogDescription></DialogHeader>
      <p className="text-3xl font-semibold tabular-nums">{kpiMoney(calculation.totalUzs, language)}</p>
      <KpiPayTable lines={calculation.payLines} />
    </DialogContent></Dialog>
    {reviewOpen ? <KpiSaleReviewDialog sales={calculation.reviewableSales} onClose={() => setReviewOpen(false)} /> : null}
  </section>;
}

export function SalesKpiOverview({ managerId, isAdministration }: { managerId: number | null; isAdministration: boolean }) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => kpiMonth());
  const query = useKpiOverview(month, managerId);
  return <section className="space-y-4" aria-label={t('kpiTitle')}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Target className="size-5 text-primary" />{(managerId === null && isAdministration ? t('kpiTeamOverview') : t('kpiOverviewTitle'))}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('kpiTimezone')}</p></div>
      <div className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" /><Label htmlFor="kpi-month" className="shrink-0 text-xs">{t('kpiMonth')}</Label>
        <Input id="kpi-month" className="w-44" type="month" value={month} max={kpiMonth()} onChange={(event) => {
          if (kpiMonthSchema.safeParse(event.target.value).success && event.target.value <= kpiMonth()) setMonth(event.target.value);
        }} /></div>
    </div>
    {query.isPending ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-52 w-full" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[0, 1, 2].map((id) => <Skeleton key={id} className="h-36 w-full" />)}</div></div>
      : query.isError ? <Alert variant="destructive"><AlertTitle>{t('failedToLoadData')}</AlertTitle><AlertDescription><Button variant="outline" onClick={() => query.refetch()}>{t('retry')}</Button></AlertDescription></Alert>
        : query.data.employees.length ? <div className="space-y-8">{query.data.employees.map((employee) => <EmployeeOverview key={`${month}-${employee.id}`} employee={employee} month={month} />)}</div>
          : <Card className="border-dashed bg-muted/15 shadow-none"><CardContent className="flex flex-col items-start gap-3 p-6"><Target className="size-7 text-muted-foreground" /><h3 className="font-semibold">{t('kpiNoSystemTitle')}</h3>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{(isAdministration ? t('kpiNoSystemDescription') : t('kpiNoSystemSelf'))}</p>
          </CardContent></Card>}
    <p className="text-xs leading-relaxed text-muted-foreground">{t('kpiTrackingHint')}</p>
  </section>;
}
