import { PhoneCall } from 'lucide-react';
import type { SalesActivityReport, SalesContactBreakdown } from '@shared/contracts/sales-report';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { salesReportUnitKey } from '../../report-labels';

type ContactRow = { key: keyof SalesContactBreakdown; labelKey: TranslationKey; color: string };
const attempts: ContactRow[] = [
  { key: 'firstAttempt', labelKey: 'salesReportAttemptFirst', color: '#5275d6' },
  { key: 'secondAttempt', labelKey: 'salesReportAttemptSecond', color: '#6b83d0' },
  { key: 'thirdAttempt', labelKey: 'salesReportAttemptThird', color: '#8597d1' },
  { key: 'laterAttempt', labelKey: 'salesReportAttemptLater', color: '#9a70cc' },
  { key: 'incomingFirst', labelKey: 'salesReportIncomingFirst', color: '#279b92' },
  { key: 'attemptedUnreached', labelKey: 'salesReportAttemptedUnreached', color: '#bd9557' },
  { key: 'notAttempted', labelKey: 'salesReportNotAttempted', color: '#92a2bb' },
];
const outcomes: ContactRow[] = [
  { key: 'reachedQualifiedInWork', labelKey: 'salesReportReachedQualifiedInWork', color: '#299981' },
  { key: 'reachedArchived', labelKey: 'salesReportReachedArchived', color: '#9a70cc' },
  { key: 'reachedUnqualifiedInWork', labelKey: 'salesReportReachedUnqualifiedInWork', color: '#bd9557' },
];

export function SalesReportContactFlow({ report }: { report?: SalesActivityReport }) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language);
  const percentage = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
  const share = (value: number, total: number) => total > 0 ? percentage.format(value / total) : '—';
  return <section aria-label={t('salesReportFirstContact')} className="sales-report-contact min-w-0 overflow-hidden rounded-2xl border border-border/65 bg-card text-card-foreground shadow-sm">
    <header data-topographic="card" className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-5 py-4">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold"><PhoneCall className="size-4 text-muted-foreground" aria-hidden="true" />{t('salesReportFirstContact')}</h3>
      {report ? <span className="text-xs tabular-nums text-muted-foreground">{t('salesReportCohortSize', { count: number.format(report.newLeads) })}</span> : null}
    </header>
    {!report ? <div className="grid gap-6 p-5 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div> :
      <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <table className="w-full table-fixed text-xs">
          <thead><tr className="text-[11px] text-muted-foreground">
            <th scope="col" className="pb-2 text-left font-medium">{t('salesReportContactResult')}</th>
            <th scope="col" className="w-14 pb-2 text-right font-medium">{t('salesReportCount')}</th>
            <th scope="col" className="w-20 pb-2 text-right font-medium">{t('salesReportShareOfNewHeading')}</th>
          </tr></thead>
          <tbody>{attempts.map((item, index) => {
            const count = report.contactBreakdown[item.key];
            return <tr key={item.key} className={index === 5 ? 'border-t border-border/60' : ''}>
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="block break-words leading-5">{t(item.labelKey)}</span>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/70" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${report.newLeads > 0 ? count / report.newLeads * 100 : 0}%`, backgroundColor: item.color }} />
                </div>
              </th>
              <td className="text-right font-semibold tabular-nums">{number.format(count)}</td>
              <td className="text-right tabular-nums text-muted-foreground">{share(count, report.newLeads)}</td>
            </tr>;
          })}</tbody>
        </table>
        <section aria-label={t('salesReportContactOutcomes')} className="min-w-0 rounded-xl border border-border/50 bg-muted/15 p-4 sm:p-5">
          <h4 className="text-sm font-semibold">{t('salesReportContactOutcomes')}</h4>
          <p className="mt-3 flex items-baseline gap-2 tabular-nums">
            <span className="text-3xl font-semibold tracking-tight">{number.format(report.reachedLeads)}</span>
            <span className="text-xs text-muted-foreground">{t(salesReportUnitKey('leads', report.reachedLeads, language))}</span>
          </p>
          <div className="my-5 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {outcomes.map(item => <div key={item.key} style={{
              width: `${report.reachedLeads > 0 ? report.contactBreakdown[item.key] / report.reachedLeads * 100 : 0}%`,
              backgroundColor: item.color,
            }} />)}
          </div>
          <dl className="space-y-5">{outcomes.map(item => <div key={item.key} className="flex items-start justify-between gap-3">
            <dt className="flex min-w-0 items-start gap-2 text-xs leading-5">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />{t(item.labelKey)}
            </dt>
            <dd className="shrink-0 text-right tabular-nums">
              <span className="block text-base font-semibold">{number.format(report.contactBreakdown[item.key])}</span>
              <span className="block text-[11px] text-muted-foreground">{share(report.contactBreakdown[item.key], report.reachedLeads)}</span>
            </dd>
          </div>)}</dl>
        </section>
      </div>}
  </section>;
}
