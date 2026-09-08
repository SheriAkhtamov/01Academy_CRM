import { useState } from 'react';
import { kpiSaleReviewSchema, type KpiSaleFact, type KpiSaleReview } from '@shared/sales-kpi';
import { kpiMonth } from '@shared/sales-kpi-time';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { OverviewDialog, overviewButton } from '@/components/ux/sales-overview/OverviewDialog';
import { useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useReviewKpiPayment } from '../hooks';
import { kpiMoney, saleKindKeys } from '../copy';

const fieldClass = 'w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

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
    <OverviewDialog title={`${t('kpiSalesReview')} · ${sale.name}`} description={t('kpiSalesReviewHint')} onClose={() => { if (!mutation.isPending) guard.handleOpenChange(false); }}>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (mutation.isPending) return;
        const parsed = kpiSaleReviewSchema.safeParse({ kind, cycleKey: cycleKey || null, referralInitiated: kind === 'new' && referralInitiated, reason });
        if (!parsed.success) { setValidationError(true); return; }
        try { await mutation.mutateAsync({ id: sale.id, input: parsed.data }); toast({ title: t('kpiReviewSaved') }); onClose(); } catch { /* Keep the draft. */ }
      }}>
        <div className="space-y-1.5"><label htmlFor="kpi-sale-kind">{t('kpiSaleKind')}</label>
          <select id="kpi-sale-kind" className={fieldClass} value={kind} disabled={sale.kind === 'new' || sale.kind === 'installment'} onChange={(event) => setKind(event.target.value as KpiSaleReview['kind'])}>
            {(['new', 'renewal', 'upsell', 'installment'] as const).filter((value) => (sale.kind === 'new') === (value === 'new')).map((value) => <option key={value} value={value}>{t(saleKindKeys[value])}</option>)}
          </select>
        </div>
        {['renewal', 'upsell'].includes(kind) ? <div className="space-y-1.5"><label htmlFor="kpi-sale-cycle">{t('kpiCycleKey')}</label>
          <input className={fieldClass} id="kpi-sale-cycle" maxLength={120} value={cycleKey} required placeholder={t('kpiCyclePlaceholder')} onChange={(event) => setCycleKey(event.target.value)} /></div> : null}
        {kind === 'new' ? <div className="flex items-center justify-between gap-3"><label htmlFor="kpi-referral">{t('kpiReferralInitiated')}</label><input type="checkbox" id="kpi-referral" className="size-5 accent-primary" checked={referralInitiated} onChange={(event) => setReferralInitiated(event.target.checked)} /></div> : null}
        <div className="space-y-1.5"><label htmlFor="kpi-review-reason">{t('kpiReviewReason')}</label>
          <textarea className={`${fieldClass} min-h-24`} id="kpi-review-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        {validationError ? <p role="alert" className="text-sm text-destructive">{['renewal', 'upsell'].includes(kind) && !cycleKey.trim() ? t('kpiCycleRequired') : t('fillRequiredFields')}</p> : null}
        {mutation.isError ? <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" className={`${overviewButton} border`} onClick={() => guard.handleOpenChange(false)} disabled={mutation.isPending}>{t('cancel')}</button><button type="submit" className={`${overviewButton} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={mutation.isPending}>{t(mutation.isPending ? 'saving' : 'save')}</button></div>
      </form>
    </OverviewDialog>
    {guard.confirmationOpen ? <OverviewDialog role="alertdialog" title={t('unsavedChangesTitle')} description={t('unsavedChangesDescription')} onClose={() => guard.setConfirmationOpen(false)}>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={`${overviewButton} border`} onClick={() => guard.setConfirmationOpen(false)}>{t('keepEditing')}</button><button type="button" className={`${overviewButton} bg-destructive text-destructive-foreground hover:bg-destructive/90`} onClick={guard.discardChanges}>{t('discardChanges')}</button></div>
    </OverviewDialog> : null}
  </>;
}

export function KpiSaleReviewDialog({ sales, onClose }: { sales: KpiSaleFact[]; onClose: () => void }) {
  const { t, language } = useTranslation();
  const [editing, setEditing] = useState<KpiSaleFact | null>(null);
  return <>
    <OverviewDialog title={t('kpiSalesReview')} description={t('kpiSalesReviewHint')} onClose={onClose}>
      <div className="overflow-x-auto">
      <table className="w-full text-sm [&_th]:p-3 [&_th:first-child]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:p-3 [&_tr]:border-b"><thead><tr><th>{t('kpiRecord')}</th><th>{t('kpiSaleKind')}</th><th className="text-right">{t('amount')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead>
        <tbody>{sales.map((sale) => <tr key={sale.id}>
          <td>{sale.name}</td><td><span className="rounded bg-muted px-2 py-1 text-xs">{t(saleKindKeys[sale.kind])}</span></td>
          <td className="whitespace-nowrap text-right tabular-nums">{kpiMoney(sale.amountUzs, language)}</td>
          <td><button type="button" className={overviewButton} disabled={kpiMonth(sale.paidAt) !== kpiMonth()} onClick={() => setEditing(sale)}>{t('edit')}</button></td>
        </tr>)}</tbody>
      </table>
      </div>
    </OverviewDialog>
    {editing ? <SaleEditor key={editing.id} sale={editing} onClose={() => setEditing(null)} /> : null}
  </>;
}
