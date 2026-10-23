import { Fragment, useState } from 'react';
import { UserPlus, PhoneCall, UserCheck, BadgeCheck, CalendarPlus, GraduationCap, CircleCheck } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import type { SalesReportMetric } from '@shared/contracts/sales-report';
import { useSalesActivityReport } from '@/features/sales/queries';
import { SalesReportMetricCard } from '@/features/sales/ui/report/SalesReportMetricCard';
import { SalesReportClosures } from '@/features/sales/ui/report/SalesReportClosures';
import { SalesReportContactFlow } from '@/features/sales/ui/report/SalesReportContactFlow';
import { salesReportUnitKey } from '@/features/sales/report-labels';
import { formatAcademyDate } from '@/lib/localeFormat';
import type { SalesReportChartKind } from '@/features/sales/ui/report/SalesReportTrend';
import { Button } from '@/components/ui/button';
import { DemoStudentsDialog } from './sales-overview/DemoStudentsDialog';
import '@/features/sales/ui/report/sales-report.css';

const metrics = [
  { key: 'newLeads', labelKey: 'salesReportNewLeads', unit: 'leads', icon: UserPlus,
    color: '#5275d6', kind: 'area', featured: true },
  { key: 'processedLeads', labelKey: 'salesReportProcessedLeads', unit: 'leads', icon: UserCheck,
    color: '#279b92', kind: 'bars' },
  { key: 'reachedLeads', labelKey: 'salesReportReachedLeads', unit: 'leads', icon: PhoneCall,
    color: '#c58b42', kind: 'stems' },
  { key: 'qualifiedLeads', labelKey: 'salesReportQualifiedLeads', unit: 'leads', icon: BadgeCheck,
    color: '#9a70cc', kind: 'steps', cumulative: true },
  { key: 'demoBookings', labelKey: 'salesReportBookings', unit: 'students', icon: CalendarPlus,
    color: '#bd9557', kind: 'bars' },
  { key: 'demoAttendees', labelKey: 'salesReportAttendance', unit: 'students', icon: GraduationCap,
    color: '#578aba', kind: 'line' },
  { key: 'successfulStudents', labelKey: 'salesReportSuccessful', unit: 'students', icon: CircleCheck,
    color: '#299981', kind: 'area', cumulative: true },
] satisfies Array<{
  key: SalesReportMetric; labelKey: TranslationKey; unit: 'leads' | 'students'; icon: typeof UserPlus;
  color: string; kind: SalesReportChartKind; featured?: boolean; cumulative?: boolean;
}>;

type SalesOverviewMetricsProps = {
  reportingRange: { from: string; to: string };
  managerId: number | null;
  funnelId: number | null;
  onOpenLead?: (leadId: number) => void;
};

export function SalesOverviewMetrics({ reportingRange, managerId, funnelId, onOpenLead }: SalesOverviewMetricsProps) {
  const { t, language } = useTranslation();
  const [showStudents, setShowStudents] = useState(false);
  const report = useSalesActivityReport({ ...reportingRange, managerId, funnelId });
  if (report.isError) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4">
    <span className="text-sm text-destructive">{t('failedToLoadData')}</span>
    <Button variant="outline" size="sm" onClick={() => report.refetch()}>{t('retry')}</Button>
  </div>;

  return <section className="sales-report space-y-5" aria-label={t('salesReportTitle')} aria-busy={report.isFetching}>
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('salesReportTitle')}</h2>
      {report.data ? <span className="text-xs text-muted-foreground">{t('salesReportAsOf', {
        date: formatAcademyDate(report.data.asOf, language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      })}</span> : null}
    </header>
    <div className="sales-report-grid">
      {metrics.map(metric => <Fragment key={metric.key}>
        <SalesReportMetricCard metric={metric.key} title={t(metric.labelKey)}
          unit={t(salesReportUnitKey(metric.unit, report.data?.[metric.key] ?? 0, language))} icon={metric.icon}
          color={metric.color} kind={metric.kind} cumulative={'cumulative' in metric && metric.cumulative}
          featured={'featured' in metric && metric.featured} className={'featured' in metric ? 'sales-report-featured' : undefined}
          value={report.data?.[metric.key]} daily={report.data?.daily}
          cohortTotal={metric.unit === 'leads' && metric.key !== 'newLeads' ? report.data?.newLeads : undefined}
          onOpen={metric.key === 'demoAttendees' ? () => setShowStudents(true) : undefined} />
        {metric.key === 'reachedLeads' ? <SalesReportContactFlow report={report.data} /> : null}
      </Fragment>)}
    </div>
    <SalesReportClosures report={report.data} />
    {showStudents ? <DemoStudentsDialog key={`${reportingRange.from}-${reportingRange.to}-${managerId}-${funnelId}`} reportingRange={reportingRange} managerId={managerId} funnelId={funnelId} onClose={() => setShowStudents(false)} onOpenLead={onOpenLead} /> : null}
  </section>;
}
