import { useState } from 'react';
import { Check, Clock3, X } from 'lucide-react';
import type { KpiMetric } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { metricKeys } from '../copy';

export function KpiMetricDetails({ metric, help, onClose }: { metric: KpiMetric; help: string; onClose: () => void }) {
  const { t, language } = useTranslation();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  const filtered = metric.details.filter((detail) => detail.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const dateFormat = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' });
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>{t(metricKeys[metric.id])}</DialogTitle><DialogDescription>{t('kpiDetailsDescription')}</DialogDescription></DialogHeader>
      <p className="text-sm leading-relaxed text-muted-foreground">{help}</p>
      <div className="space-y-1.5"><Label htmlFor="kpi-detail-search" className="sr-only">{t('kpiSearchDetails')}</Label>
        <Input id="kpi-detail-search" placeholder={t('kpiSearchDetails')} value={search} onChange={(event) => { setSearch(event.target.value); setLimit(50); }} /></div>
      <p className="text-xs text-muted-foreground">{t('kpiDetailsCount').replace('{count}', String(filtered.length))}</p>
      <div className="min-h-0 overflow-auto rounded-lg border"><Table><TableHeader><TableRow>
        <TableHead>{t('kpiRecord')}</TableHead><TableHead>{t('kpiEventDate')}</TableHead><TableHead className="text-right">{t('kpiResult')}</TableHead>
      </TableRow></TableHeader><TableBody>
        {filtered.slice(0, limit).map((detail, index) => <TableRow key={`${detail.entity}-${detail.id}-${index}`}>
          <TableCell className="font-medium">{detail.name}</TableCell>
          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{detail.date ? dateFormat.format(new Date(detail.date)) : t('kpiNoData')}</TableCell>
          <TableCell className="text-right"><div className="flex items-center justify-end gap-2">
            {detail.value !== undefined && detail.value !== null ? <span className="tabular-nums">{Number.isFinite(detail.value) ? new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(detail.value) : t('kpiNoData')}</span> : null}
            {detail.success === true ? <Check className="size-4 text-emerald-600" aria-label={t('kpiEarned')} /> : detail.success === false
              ? <X className="size-4 text-amber-600" aria-label={t('kpiNotMet')} /> : detail.success === null
                ? <Clock3 className="size-4 text-muted-foreground" aria-label={t('kpiPending')} /> : null}
          </div></TableCell>
        </TableRow>)}
        {!filtered.length ? <TableRow><TableCell colSpan={3} className="py-10 text-center text-muted-foreground">{t('kpiNoData')}</TableCell></TableRow> : null}
      </TableBody></Table></div>
      {filtered.length > limit ? <Button variant="outline" onClick={() => setLimit((value) => value + 50)}>{t('kpiShowMore')}</Button> : null}
    </DialogContent>
  </Dialog>;
}
