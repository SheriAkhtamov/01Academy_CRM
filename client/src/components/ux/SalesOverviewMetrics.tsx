import { useState } from 'react';
import { UserPlus, PhoneCall, UserCheck, BadgeCheck, CalendarPlus, GraduationCap, CircleCheck } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import type { SalesReportMetric } from '@shared/contracts/sales-report';
import { useSalesActivityReport } from '@/features/sales/queries';
import { SalesReportMetricCard } from '@/features/sales/ui/report/SalesReportMetricCard';
import { SalesReportClosures } from '@/features/sales/ui/report/SalesReportClosures';
import type { SalesReportChartKind } from '@/features/sales/ui/report/SalesReportTrend';
import { Button } from '@/components/ui/button';
import { DemoStudentsDialog } from './sales-overview/DemoStudentsDialog';
import '@/features/sales/ui/report/sales-report.css';

const metrics = [
  { key: 'newLeads', labelKey: 'salesReportNewLeads', unitKey: 'salesReportLeadUnit', icon: UserPlus,
    color: '#5275d6', kind: 'area', featured: true },
  { key: 'processedLeads', labelKey: 'salesReportProcessedLeads', unitKey: 'salesReportLeadUnit', icon: UserCheck,
    color: '#279b92', kind: 'bars' },
  { key: 'reachedCalls', labelKey: 'salesReportReachedCalls', unitKey: 'salesReportCallUnit', icon: PhoneCall,
    color: '#c58b42', kind: 'stems' },
  { key: 'qualifiedLeads', labelKey: 'salesReportQualifiedLeads', unitKey: 'salesReportLeadUnit', icon: BadgeCheck,
    color: '#9a70cc', kind: 'steps', cumulative: true },
  { key: 'demoBookings', labelKey: 'salesReportBookings', unitKey: 'salesReportStudentUnit', icon: CalendarPlus,
    color: '#bd9557', kind: 'bars' },
  { key: 'demoAttendees', labelKey: 'salesReportAttendance', unitKey: 'salesReportStudentUnit', icon: GraduationCap,
    color: '#578aba', kind: 'line' },
  { key: 'successfulStudents', labelKey: 'salesReportSuccessful', unitKey: 'salesReportStudentUnit', icon: CircleCheck,
    color: '#299981', kind: 'area', cumulative: true },
] satisfies Array<{
  key: SalesReportMetric; labelKey: TranslationKey; unitKey: TranslationKey; icon: typeof UserPlus;
  color: string; kind: SalesReportChartKind; featured?: boolean; cumulative?: boolean;
}>;

type SalesOverviewMetricsProps = {
  reportingRange: { from: string; to: string };
  managerId: number | null;
  funnelId: number | null;
  onOpenLead?: (leadId: number) => void;
};

export function SalesOverviewMetrics({ reportingRange, managerId, funnelId, onOpenLead }: SalesOverviewMetricsProps) {
  const { t } = useTranslation();
  const [showStudents, setShowStudents] = useState(false);
  const report = useSalesActivityReport({ ...reportingRange, managerId, funnelId });
  if (report.isError) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4">
    <span className="text-sm text-destructive">{t('failedToLoadData')}</span>
    <Button variant="outline" size="sm" onClick={() => report.refetch()}>{t('retry')}</Button>
  </div>;

  return <section className="sales-report space-y-5" aria-label={t('salesReportTitle')} aria-busy={report.isFetching}>
    <h2 className="sr-only">{t('salesReportTitle')}</h2>
    <div className="sales-report-grid">
      {metrics.map(metric => <SalesReportMetricCard key={metric.key}
        metric={metric.key} title={t(metric.labelKey)} unit={t(metric.unitKey)} icon={metric.icon}
        color={metric.color} kind={metric.kind} cumulative={'cumulative' in metric && metric.cumulative}
        featured={'featured' in metric && metric.featured} className={'featured' in metric ? 'sales-report-featured' : undefined}
        value={report.data?.[metric.key]} daily={report.data?.daily}
        onOpen={metric.key === 'demoAttendees' ? () => setShowStudents(true) : undefined} />)}
    </div>
    <SalesReportClosures report={report.data} />
    {showStudents ? <DemoStudentsDialog key={`${reportingRange.from}-${reportingRange.to}-${managerId}-${funnelId}`} reportingRange={reportingRange} managerId={managerId} funnelId={funnelId} onClose={() => setShowStudents(false)} onOpenLead={onOpenLead} /> : null}
  </section>;
}
