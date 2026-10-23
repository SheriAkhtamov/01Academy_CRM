import { Archive } from 'lucide-react';
import { LEAD_ARCHIVE_REASONS } from '@shared/academy';
import type { SalesActivityReport } from '@shared/contracts/sales-report';
import { useTranslation } from '@/hooks/useTranslation';
import { Skeleton } from '@/components/ui/skeleton';

const COLORS = ['#647bd6', '#9b7bd4', '#d29b55', '#4eaaa2', '#92a2bb', '#c57d99', '#83a779', '#8493c3'];

export function SalesReportClosures({ report }: { report?: SalesActivityReport }) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language);
  const percentage = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
  const reasons = report?.closedReasons ?? [];
  const total = report?.closedLeads ?? 0;
  const label = (reason: string) => {
    const known = LEAD_ARCHIVE_REASONS.find(item => item.code === reason);
    return known ? t(known.translationKey) : reason === 'unspecified' ? t('salesReportUnspecifiedReason') : reason;
  };
  let offset = 0;
  const segments = reasons.map((reason, index) => {
    const share = total > 0 ? reason.count / total * 100 : 0;
    const segment = { ...reason, share, offset, color: COLORS[index % COLORS.length] };
    offset += share;
    return segment;
  });

  return <section className="min-w-0 overflow-hidden rounded-2xl border border-border/65 bg-card text-card-foreground shadow-sm"
    aria-label={t('salesReportClosedReasons')}>
    <header data-topographic="card" className="flex items-center gap-2.5 border-b border-border/50 px-5 py-4">
      <Archive className="size-4 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-sm font-semibold">{t('salesReportClosedReasons')}</h3>
    </header>
    {!report ? <div className="grid gap-6 p-6 sm:grid-cols-[240px_minmax(0,1fr)]">
      <Skeleton className="mx-auto size-52 rounded-full" /><Skeleton className="h-52 w-full rounded-xl" />
    </div> : <div className="grid items-center gap-6 p-5 sm:p-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <div className="relative mx-auto flex size-56 items-center justify-center">
        <svg viewBox="0 0 200 200" className="size-full -rotate-90" role="img"
          aria-label={`${t('salesReportClosedReasons')}: ${segments.map(item => `${label(item.reason)} ${number.format(item.count)}`).join('; ') || number.format(0)}`}>
          <circle cx="100" cy="100" r="80" fill="none" stroke="var(--muted)" strokeWidth="18" />
          {segments.map(item => <circle key={item.reason} cx="100" cy="100" r="80" pathLength="100"
            fill="none" stroke={item.color} strokeWidth="18"
            strokeDasharray={`${Math.max(0, item.share - Math.min(0.7, item.share / 5))} 100`}
            strokeDashoffset={-item.offset} />)}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">{number.format(total)}</span>
          <span className="text-xs text-muted-foreground">{t('salesReportClosedUnit')}</span>
          {report.newLeads > 0 ? <span className="text-[11px] text-muted-foreground">
            {t('salesReportShareOfNew', { percent: percentage.format(total / report.newLeads) })}
          </span> : null}
        </div>
      </div>
      {!reasons.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t('salesReportNoClosedLeads')}</p> :
        <div className="min-w-0">
          <table className="w-full table-fixed text-sm">
            <thead><tr className="text-[11px] text-muted-foreground">
              <th scope="col" className="pb-2 text-left font-medium">{t('salesReportReason')}</th>
              <th scope="col" className="w-20 pb-2 text-right font-medium">{t('salesReportCount')}</th>
              <th scope="col" className="w-16 pb-2 text-right font-medium">{t('salesReportShare')}</th>
            </tr></thead>
            <tbody>{segments.map(item => <tr key={item.reason} className="border-t border-border/40">
              <td className="py-3 pr-3">
                <div className="mb-2 flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  <span className="break-words text-xs leading-5 [overflow-wrap:anywhere]">{label(item.reason)}</span>
                </div>
                <div className="ml-3.5 h-1.5 overflow-hidden rounded-full bg-muted/70" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${item.share}%`, backgroundColor: item.color }} />
                </div>
              </td>
              <td className="py-3 text-right font-semibold tabular-nums">{number.format(item.count)}</td>
              <td className="py-3 text-right text-xs tabular-nums text-muted-foreground">{percentage.format(item.share / 100)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>}
  </section>;
}
