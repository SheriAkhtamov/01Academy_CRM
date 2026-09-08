import { useState } from 'react';
import { ArrowRight, CheckCircle2, Send, UsersRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useHandoffKpiLead, useKpiLead, useRecordKpiOffer } from '../hooks';

export function KpiLeadOwnershipCard({ leadId, beforeHandoff, onHandedOff }: {
  leadId: number; beforeHandoff: (action: () => void) => void; onHandedOff: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const query = useKpiLead(leadId);
  const handoff = useHandoffKpiLead();
  const offer = useRecordKpiOffer();
  const [open, setOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [closerId, setCloserId] = useState('');
  if (query.isPending) return <Skeleton className="h-20 w-full" />;
  if (query.isError) return <div className="rounded-lg border p-3"><Button variant="ghost" size="sm" onClick={() => query.refetch()}>{t('kpiOwnership')} · {t('retry')}</Button></div>;
  const data = query.data;
  if (!data.hunter && !data.closer) return null;
  return <>
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="size-4 text-muted-foreground" />{t('kpiOwnership')}</h3>
        <div className="flex flex-wrap gap-2">
          {data.canHandoff ? <Button variant="outline" size="sm" onClick={() => beforeHandoff(() => setOpen(true))}>{t('kpiHandoff')}<ArrowRight className="ml-2 size-4" /></Button> : null}
          {data.canRecordOffer ? <Button variant="outline" size="sm" onClick={() => setOfferOpen(true)}><Send className="mr-2 size-4" />{t('kpiRecordOffer')}</Button> : null}
          {data.offerAt ? <span className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" />{t('kpiOfferRecorded')}</span> : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><p className="text-sm"><span className="text-muted-foreground">{t('kpiHunter')}: </span>{data.hunter?.name ?? t('kpiNotAssigned')}</p>
        <p className="text-sm"><span className="text-muted-foreground">{t('kpiCloser')}: </span>{data.closer?.name ?? t('kpiNotAssigned')}</p></div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('kpiOwnershipHint')}</p>
    </div>
    <Dialog open={open} onOpenChange={(value) => { if (!handoff.isPending) setOpen(value); }}><DialogContent>
      <DialogHeader><DialogTitle>{t('kpiHandoff')}</DialogTitle><DialogDescription>{t('kpiHandoffDescription')}</DialogDescription></DialogHeader>
      {data.closers.length ? <div className="space-y-1.5"><Label htmlFor="kpi-closer-choice">{t('kpiSelectCloser')}</Label>
        <Select value={closerId} onValueChange={setCloserId}><SelectTrigger id="kpi-closer-choice"><SelectValue placeholder={t('kpiSelectCloser')} /></SelectTrigger><SelectContent>
          {data.closers.map((closer) => <SelectItem key={closer.id} value={String(closer.id)}>{closer.name}</SelectItem>)}
        </SelectContent></Select></div> : <p className="text-sm text-muted-foreground">{t('kpiNoClosers')}</p>}
      {handoff.isError ? <Alert variant="destructive"><AlertDescription>{handoff.error.message}</AlertDescription></Alert> : null}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={handoff.isPending} onClick={() => setOpen(false)}>{t('cancel')}</Button>
        <Button disabled={!closerId || handoff.isPending} onClick={async () => {
          try { await handoff.mutateAsync({ leadId, closerId: Number(closerId) }); toast({ title: t('kpiHandoffDone') }); setOpen(false); onHandedOff(); } catch { /* Keep the selection for retry. */ }
        }}>{handoff.isPending ? t('saving') : t('kpiHandoff')}</Button></div>
    </DialogContent></Dialog>
    <Dialog open={offerOpen} onOpenChange={(value) => { if (!offer.isPending) setOfferOpen(value); }}><DialogContent>
      <DialogHeader><DialogTitle>{t('kpiRecordOffer')}</DialogTitle><DialogDescription>{t('kpiRecordOfferHint')}</DialogDescription></DialogHeader>
      {offer.isError ? <Alert variant="destructive"><AlertDescription>{offer.error.message}</AlertDescription></Alert> : null}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={offer.isPending} onClick={() => setOfferOpen(false)}>{t('cancel')}</Button>
        <Button disabled={offer.isPending} onClick={async () => {
          try { await offer.mutateAsync(leadId); toast({ title: t('kpiOfferRecorded') }); setOfferOpen(false); } catch { /* Keep the confirmation visible. */ }
        }}>{offer.isPending ? t('saving') : t('kpiRecordOffer')}</Button></div>
    </DialogContent></Dialog>
  </>;
}
