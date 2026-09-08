import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { kpiMonth, kpiMonthBounds, nextKpiMonth } from '@shared/sales-kpi-time';
import { kpiMonthSchema } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { reportingToday, addReportingDays, type ReportingDateRange } from '@/lib/reportingDateRange';
import { overviewButton } from './OverviewDialog';

export function salesMonthRange(month: string, today = reportingToday()): ReportingDateRange {
  return { from: `${month}-01`, to: month === today.slice(0, 7) ? today : addReportingDays(`${nextKpiMonth(month)}-01`, -1), preset: 'custom' };
}

export function SalesOverviewMonthFilter({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const { t, language } = useTranslation();
  const current = kpiMonth();
  const previous = kpiMonth(new Date(kpiMonthBounds(month).start.getTime() - 1));
  const label = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' }).format(kpiMonthBounds(month).start);
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <div className="flex min-w-0 items-center rounded-xl border bg-background p-1">
      <button type="button" className={overviewButton} aria-label={t('previousMonth')} disabled={month <= '2000-01'} onClick={() => onChange(previous)}><ChevronLeft className="size-4" aria-hidden="true" /></button>
      <label className="relative flex min-h-10 min-w-0 cursor-pointer items-center gap-2 px-2 sm:px-3">
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-semibold capitalize">{label}</span>
        <input type="month" value={month} min="2000-01" max={current} aria-label={t('calendarViewMonth')}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100"
          onClick={(event) => event.currentTarget.showPicker?.()}
          onChange={(event) => { const value = event.target.value; if (kpiMonthSchema.safeParse(value).success && value <= current) onChange(value); }} />
      </label>
      <button type="button" className={overviewButton} aria-label={t('nextMonth')} disabled={month >= current} onClick={() => onChange(nextKpiMonth(month))}><ChevronRight className="size-4" aria-hidden="true" /></button>
    </div>
    {month !== current ? <button type="button" className={`${overviewButton} text-muted-foreground`} onClick={() => onChange(current)}>{t('reportingThisMonth')}</button> : null}
  </div>;
}
