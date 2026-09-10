import { useState } from 'react';
import { CheckCircle2, Send, UserCheck, UsersRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useClaimKpiLead, useKpiLead, useRecordKpiOffer } from '../hooks';

export function KpiLeadOwnershipCard({ leadId, beforeHandoff }: {
  leadId: number; beforeHandoff: (action: () => void) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const query = useKpiLead(leadId);
  const claim = useClaimKpiLead();
  const offer = useRecordKpiOffer();
  const [offerOpen, setOfferOpen] = useState(false);
  if (query.isPending) return <Skeleton className="h-20 w-full" />;
  if (query.isError) return <div className="rounded-lg border p-3"><Button variant="ghost" size="sm" onClick={() => query.refetch()}>{t('kpiOwnership')} · {t('retry')}</Button></div>;
  const data = query.data;
  if (!data.hunter && !data.closer && !data.inCloserQueue) return null;
  return <>
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="size-4 text-muted-foreground" />{t('kpiOwnership')}</h3>
        <div className="flex flex-wrap gap-2">
          {data.inCloserQueue ? <Badge variant="secondary">{t('closerQueuePending')}</Badge> : null}
          {data.canClaim ? <Button type="button" size="sm" disabled={claim.isPending}
            onClick={() => beforeHandoff(() => {
              claim.mutate(leadId, { onSuccess: () => {
                toast({ title: t('closerLeadClaimed') });
              } });
            })}><UserCheck className="mr-2 size-4" />{claim.isPending ? t('saving') : t('claimCloserLead')}</Button> : null}
          {data.canRecordOffer ? <Button type="button" variant="outline" size="sm" onClick={() => setOfferOpen(true)}><Send className="mr-2 size-4" />{t('kpiRecordOffer')}</Button> : null}
          {data.offerAt ? <span className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" />{t('kpiOfferRecorded')}</span> : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <p className="text-sm"><span className="text-muted-foreground">{t('kpiHunter')}: </span>{data.hunter?.name ?? t('kpiNotAssigned')}</p>
        <p className="text-sm"><span className="text-muted-foreground">{t('kpiCloser')}: </span>{data.closer?.name ?? t('kpiNotAssigned')}</p>
      </div>
      {claim.isError ? <Alert variant="destructive" className="mt-3"><AlertDescription>{claim.error.message}</AlertDescription></Alert> : null}
    </div>
    <Dialog open={offerOpen} onOpenChange={(value) => { if (!offer.isPending) setOfferOpen(value); }}><DialogContent>
      <DialogHeader><DialogTitle>{t('kpiRecordOffer')}</DialogTitle><DialogDescription>{t('kpiRecordOfferHint')}</DialogDescription></DialogHeader>
      {offer.isError ? <Alert variant="destructive"><AlertDescription>{offer.error.message}</AlertDescription></Alert> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={offer.isPending} onClick={() => setOfferOpen(false)}>{t('cancel')}</Button>
        <Button type="button" disabled={offer.isPending} onClick={async () => {
          try { await offer.mutateAsync(leadId); toast({ title: t('kpiOfferRecorded') }); setOfferOpen(false); } catch { /* Keep the confirmation visible. */ }
        }}>{offer.isPending ? t('saving') : t('kpiRecordOffer')}</Button></div>
    </DialogContent></Dialog>
  </>;
}
