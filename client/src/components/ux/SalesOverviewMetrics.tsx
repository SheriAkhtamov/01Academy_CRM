import { useState } from 'react';
import { UserPlus, PhoneCall, UserCheck, BadgeCheck, CalendarPlus, GraduationCap, CircleCheck } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { LEAD_ARCHIVE_REASONS } from '@shared/academy';
import type { SalesActivityReport } from '@shared/contracts/sales-report';
import { useSalesActivityReport } from '@/features/sales/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DemoStudentsDialog } from './sales-overview/DemoStudentsDialog';

const metrics = [
  { key: 'newLeads', labelKey: 'salesReportNewLeads', icon: UserPlus },
  { key: 'processedLeads', labelKey: 'salesReportProcessedLeads', icon: UserCheck },
  { key: 'reachedCalls', labelKey: 'salesReportReachedCalls', icon: PhoneCall },
  { key: 'qualifiedLeads', labelKey: 'salesReportQualifiedLeads', icon: BadgeCheck },
  { key: 'demoBookings', labelKey: 'salesReportBookings', icon: CalendarPlus },
  { key: 'demoAttendees', labelKey: 'salesReportAttendance', icon: GraduationCap },
  { key: 'successfulStudents', labelKey: 'salesReportSuccessful', icon: CircleCheck },
] satisfies Array<{ key: keyof SalesActivityReport; labelKey: TranslationKey; icon: typeof UserPlus }>;

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
  const number = new Intl.NumberFormat(language);
  if (report.isError) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4">
    <span className="text-sm text-destructive">{t('failedToLoadData')}</span>
    <Button variant="outline" size="sm" onClick={() => report.refetch()}>{t('retry')}</Button>
  </div>;

  return <section className="space-y-5" aria-label={t('salesReportTitle')} aria-busy={report.isFetching}>
    <h2 className="text-base font-semibold">{t('salesReportTitle')}</h2>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ key, labelKey, icon: Icon }) => <article key={key} aria-label={t(labelKey)} className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground">
        <header data-topographic="card" className="flex min-h-16 items-center gap-2 border-b bg-muted/40 px-4 py-3">
          <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <h3 className="break-words text-sm font-medium">{t(labelKey)}</h3>
        </header>
        <div className="p-4">
          {report.isPending ? <Skeleton className="h-10 w-20" /> : key === 'demoAttendees' ?
            <button type="button" onClick={() => setShowStudents(true)} className="rounded-md text-3xl font-semibold tabular-nums text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${t(labelKey)}: ${number.format(report.data[key])}`}>
              {number.format(report.data[key])}
            </button> : <p className="text-3xl font-semibold tabular-nums">{number.format(Number(report.data?.[key] ?? 0))}</p>}
        </div>
      </article>)}
    </div>
    <section className="overflow-hidden rounded-xl border bg-card text-card-foreground" aria-label={t('salesReportClosedReasons')}>
      <header data-topographic="card" className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
        <h3 className="text-sm font-semibold">{t('salesReportClosedReasons')}</h3>
        {!report.isPending ? <span className="text-sm font-semibold tabular-nums">{number.format(report.data.closedLeads)}</span> : null}
      </header>
      {report.isPending ? <div className="p-4"><Skeleton className="h-16 w-full" /></div> : report.data.closedReasons.length === 0 ?
        <p className="p-6 text-center text-sm text-muted-foreground">{t('salesReportNoClosedLeads')}</p> :
        <table className="w-full table-fixed text-sm">
          <thead><tr className="border-b"><th scope="col" className="px-4 py-3 text-left font-medium">{t('salesReportReason')}</th><th scope="col" className="w-28 px-4 py-3 text-right font-medium">{t('salesReportCount')}</th></tr></thead>
          <tbody>{report.data.closedReasons.map(({ reason, count }) => {
            const known = LEAD_ARCHIVE_REASONS.find((item) => item.code === reason);
            return <tr key={reason} className="border-b last:border-0"><td className="break-words px-4 py-3 [overflow-wrap:anywhere]">{known ? t(known.translationKey) : reason === 'unspecified' ? t('salesReportUnspecifiedReason') : reason}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(count)}</td></tr>;
          })}</tbody>
        </table>}
    </section>
    {showStudents ? <DemoStudentsDialog key={`${reportingRange.from}-${reportingRange.to}-${managerId}-${funnelId}`} reportingRange={reportingRange} managerId={managerId} funnelId={funnelId} onClose={() => setShowStudents(false)} onOpenLead={onOpenLead} /> : null}
  </section>;
}
