import { useId, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { isReportingPresetKey, reportingRangeForPreset, type ReportingDateRange } from '@/lib/reportingDateRange';
import { MAX_SALES_REPORTING_DAYS, salesRangeError } from '@/lib/salesReportingRange';
import type { TranslationKey } from '@/lib/i18n';

const presets = {
  today: 'today', yesterday: 'yesterday', last7: 'reportingLast7Days', last30: 'reportingLast30Days',
  thisMonth: 'reportingThisMonth', previousMonth: 'reportingPreviousMonth',
} as const satisfies Record<string, TranslationKey>;
const controlClass = 'min-h-11 w-full min-w-0 rounded-xl border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SalesOverviewPeriodFilter({ value, onChange }: { value: ReportingDateRange; onChange: (range: ReportingDateRange) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const source = `${value.from}/${value.to}/${value.preset}`;
  const [draft, setDraft] = useState<{ source: string; value: ReportingDateRange } | null>(null);
  const range = draft?.source === source ? draft.value : value;
  const error = salesRangeError(range);
  const changeBoundary = (boundary: 'from' | 'to', date: string) => {
    const next: ReportingDateRange = { ...range, [boundary]: date, preset: 'custom' };
    // Move the opposite boundary when crossing it, so either calendar can be edited first.
    if (next.from && next.to && next.from > next.to) next[boundary === 'from' ? 'to' : 'from'] = date;
    if (salesRangeError(next)) setDraft({ source, value: next });
    else { setDraft(null); onChange(next); }
  };
  return <div className="min-w-0 flex-1" role="group" aria-label={t('reportingPeriod')}>
    <div className="grid min-w-0 grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
      <label className="col-span-2 min-w-0 space-y-1 sm:w-44">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><CalendarRange className="size-3.5" aria-hidden="true" />{t('reportingQuickPeriods')}</span>
        <select className={controlClass} value={range.preset} onChange={(event) => {
          if (isReportingPresetKey(event.target.value)) { setDraft(null); onChange(reportingRangeForPreset(event.target.value)); }
        }}>
          {Object.entries(presets).map(([preset, key]) => <option key={preset} value={preset}>{t(key)}</option>)}
          {range.preset === 'custom' ? <option value="custom">{t('reportingCustomPeriod')}</option> : null}
        </select>
      </label>
      {(['from', 'to'] as const).map((boundary) => <label key={boundary} className="min-w-0 space-y-1 sm:w-40">
        <span className="block text-xs font-medium text-muted-foreground">{t(boundary === 'from' ? 'dateFrom' : 'dateTo')}</span>
        <input type="date" className={controlClass} value={range[boundary]} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => changeBoundary(boundary, event.target.value)} />
      </label>)}
    </div>
    {error ? <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-destructive">
      {error === 'tooLong' ? t('salesPeriodTooLong').replace('{days}', String(MAX_SALES_REPORTING_DAYS)) : t('salesPeriodInvalid')}
    </p> : null}
  </div>;
}
