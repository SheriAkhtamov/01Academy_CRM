import { useState } from 'react';
import { Check, Clock3, X } from 'lucide-react';
import type { KpiMetric } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { OverviewDialog, overviewButton } from '@/components/ux/sales-overview/OverviewDialog';
import { metricKeys } from '../copy';

export function KpiMetricDetails({ metric, help, onClose }: { metric: KpiMetric; help: string; onClose: () => void }) {
  const { t, language } = useTranslation();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  const filtered = metric.details.filter((detail) => detail.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const dateFormat = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' });
  return <OverviewDialog title={t(metricKeys[metric.id])} description={t('kpiDetailsDescription')} onClose={onClose}>
      <p className="text-sm leading-relaxed text-muted-foreground">{help}</p>
      <div className="space-y-1.5"><label htmlFor="kpi-detail-search" className="sr-only">{t('kpiSearchDetails')}</label>
        <input className="h-11 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" id="kpi-detail-search" placeholder={t('kpiSearchDetails')} value={search} onChange={(event) => { setSearch(event.target.value); setLimit(50); }} /></div>
      <p className="text-xs text-muted-foreground">{t('kpiDetailsCount').replace('{count}', String(filtered.length))}</p>
      <div className="min-h-0 overflow-auto rounded-lg border"><table className="w-full text-sm [&_th]:p-3 [&_th:first-child]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:p-3 [&_tr]:border-b"><thead><tr>
        <th>{t('kpiRecord')}</th><th>{t('kpiEventDate')}</th><th className="text-right">{t('kpiResult')}</th>
      </tr></thead><tbody>
        {filtered.slice(0, limit).map((detail, index) => <tr key={`${detail.entity}-${detail.id}-${index}`}>
          <td className="font-medium">{detail.name}</td>
          <td className="whitespace-nowrap text-xs text-muted-foreground">{detail.date ? dateFormat.format(new Date(detail.date)) : t('kpiNoData')}</td>
          <td className="text-right"><div className="flex items-center justify-end gap-2">
            {detail.value !== undefined && detail.value !== null ? <span className="tabular-nums">{Number.isFinite(detail.value) ? new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(detail.value) : t('kpiNoData')}</span> : null}
            {detail.success === true ? <Check className="size-4 text-emerald-600" aria-label={t('kpiEarned')} /> : detail.success === false
              ? <X className="size-4 text-amber-600" aria-label={t('kpiNotMet')} /> : detail.success === null
                ? <Clock3 className="size-4 text-muted-foreground" aria-label={t('kpiPending')} /> : null}
          </div></td>
        </tr>)}
        {!filtered.length ? <tr><td colSpan={3} className="py-10 text-center text-muted-foreground">{t('kpiNoData')}</td></tr> : null}
      </tbody></table></div>
      {filtered.length > limit ? <button type="button" className={`${overviewButton} border`} onClick={() => setLimit((value) => value + 50)}>{t('kpiShowMore')}</button> : null}
  </OverviewDialog>;
}
