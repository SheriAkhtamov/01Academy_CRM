import { useState } from 'react';
import { kpiSaleReviewSchema, type KpiSaleFact, type KpiSaleReview } from '@shared/sales-kpi';
import { kpiMonth } from '@shared/sales-kpi-time';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useReviewKpiPayment } from '../hooks';
import { kpiMoney, saleKindKeys } from '../copy';

function SaleEditor({ sale, onClose }: { sale: KpiSaleFact; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const mutation = useReviewKpiPayment();
  const [kind, setKind] = useState<KpiSaleReview['kind']>(sale.kind === 'unclassified' ? 'renewal' : sale.kind);
  const [cycleKey, setCycleKey] = useState(sale.cycleKey ?? '');
  const [referralInitiated, setReferralInitiated] = useState(sale.referralInitiated);
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState(false);
  const dirty = kind !== (sale.kind === 'unclassified' ? 'renewal' : sale.kind) || cycleKey !== (sale.cycleKey ?? '') || referralInitiated !== sale.referralInitiated || reason.length > 0;
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, onOpenChange: (open) => { if (!open && !mutation.isPending) onClose(); } });
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}><DialogContent>
      <DialogHeader><DialogTitle>{t('kpiSalesReview')} · {sale.name}</DialogTitle><DialogDescription>{t('kpiSalesReviewHint')}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (mutation.isPending) return;
        const parsed = kpiSaleReviewSchema.safeParse({ kind, cycleKey: cycleKey || null, referralInitiated: kind === 'new' && referralInitiated, reason });
        if (!parsed.success) { setValidationError(true); return; }
        try { await mutation.mutateAsync({ id: sale.id, input: parsed.data }); toast({ title: t('kpiReviewSaved') }); onClose(); } catch { /* Keep the draft. */ }
      }}>
        <div className="space-y-1.5"><Label htmlFor="kpi-sale-kind">{t('kpiSaleKind')}</Label>
          <Select value={kind} disabled={sale.kind === 'new' || sale.kind === 'installment'} onValueChange={(value: KpiSaleReview['kind']) => setKind(value)}>
            <SelectTrigger id="kpi-sale-kind"><SelectValue /></SelectTrigger><SelectContent>
              {(['new', 'renewal', 'upsell', 'installment'] as const).filter((value) => (sale.kind === 'new') === (value === 'new')).map((value) => <SelectItem key={value} value={value}>{t(saleKindKeys[value])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {['renewal', 'upsell'].includes(kind) ? <div className="space-y-1.5"><Label htmlFor="kpi-sale-cycle">{t('kpiCycleKey')}</Label>
          <Input id="kpi-sale-cycle" maxLength={120} value={cycleKey} required placeholder={t('kpiCyclePlaceholder')} onChange={(event) => setCycleKey(event.target.value)} /></div> : null}
        {kind === 'new' ? <div className="flex items-center justify-between gap-3"><Label htmlFor="kpi-referral">{t('kpiReferralInitiated')}</Label><Switch id="kpi-referral" checked={referralInitiated} onCheckedChange={setReferralInitiated} /></div> : null}
        <div className="space-y-1.5"><Label htmlFor="kpi-review-reason">{t('kpiReviewReason')}</Label>
          <Textarea id="kpi-review-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        {validationError ? <p role="alert" className="text-sm text-destructive">{['renewal', 'upsell'].includes(kind) && !cycleKey.trim() ? t('kpiCycleRequired') : t('fillRequiredFields')}</p> : null}
        {mutation.isError ? <Alert variant="destructive"><AlertDescription>{mutation.error.message}</AlertDescription></Alert> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => guard.handleOpenChange(false)} disabled={mutation.isPending}>{t('cancel')}</Button><Button type="submit" disabled={mutation.isPending}>{t(mutation.isPending ? 'saving' : 'save')}</Button></div>
      </form>
    </DialogContent></Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}

export function KpiSaleReviewDialog({ sales, onClose }: { sales: KpiSaleFact[]; onClose: () => void }) {
  const { t, language } = useTranslation();
  const [editing, setEditing] = useState<KpiSaleFact | null>(null);
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>{t('kpiSalesReview')}</DialogTitle><DialogDescription>{t('kpiSalesReviewHint')}</DialogDescription></DialogHeader>
      <Table><TableHeader><TableRow><TableHead>{t('kpiRecord')}</TableHead><TableHead>{t('kpiSaleKind')}</TableHead><TableHead className="text-right">{t('amount')}</TableHead><TableHead><span className="sr-only">{t('actions')}</span></TableHead></TableRow></TableHeader>
        <TableBody>{sales.map((sale) => <TableRow key={sale.id}>
          <TableCell>{sale.name}</TableCell><TableCell><Badge variant={sale.kind === 'unclassified' ? 'outline' : 'secondary'}>{t(saleKindKeys[sale.kind])}</Badge></TableCell>
          <TableCell className="whitespace-nowrap text-right tabular-nums">{kpiMoney(sale.amountUzs, language)}</TableCell>
          <TableCell><Button variant="ghost" size="sm" disabled={kpiMonth(sale.paidAt) !== kpiMonth()} onClick={() => setEditing(sale)}>{t('edit')}</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </DialogContent></Dialog>
    {editing ? <SaleEditor key={editing.id} sale={editing} onClose={() => setEditing(null)} /> : null}
  </>;
}
