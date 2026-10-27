import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Users } from 'lucide-react';
import type { PortalPaymentAllocationDto } from '@shared/contracts/portal-resources';
import { useTranslation } from '@/hooks/useTranslation';
import { CurrencyInput } from '@/components/ux/FormattedInputs';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialogBody,
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  PortalDialogContent as DialogContent,
  PortalAlertDialogContent as AlertDialogContent,
} from '@/features/learning-content/modal-content';
import { portalFinanceApi, PortalFinanceApiError } from './api';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

function AllocationForm({ context, onClose, money }: {
  context: PortalPaymentAllocationDto;
  onClose: () => void;
  money: (value: number) => string;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  // Revalidation must never replace the version or values of an open draft.
  const [baseline] = useState(context);
  const [amounts, setAmounts] = useState(() => Object.fromEntries(context.students.map(student => [student.id, String(student.amountUzs || '')])));
  const [reason, setReason] = useState('');
  const [reasonOpen, setReasonOpen] = useState(true);
  const [reasonInvalid, setReasonInvalid] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [confirm, setConfirm] = useState(false);
  const total = Object.values(amounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const dirty = reason !== '' || baseline.students.some(student => Number(amounts[student.id] || 0) !== student.amountUzs);
  const save = useMutation({
    mutationFn: () => portalFinanceApi.saveAllocation(context.paymentId, {
      version: baseline.version,
      reason,
      allocations: baseline.students.filter(student => Number(amounts[student.id] || 0) > 0)
        .map(student => ({ studentId: student.id, amountUzs: Number(amounts[student.id]) })),
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['portal-finance'] });
      void client.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    },
  });
  const guard = useUnsavedChangesGuard({
    open: true, isDirty: dirty, isPending: save.isPending,
    onOpenChange: open => { if (!open) onClose(); },
  });
  const requestSave = () => {
    if (save.isPending || !dirty || total <= 0 || total > baseline.amountUzs) return;
    if (reason.trim().length < 3) {
      setReasonInvalid(true);
      setReasonOpen(true);
      setTimeout(() => reasonRef.current?.focus(), 0);
      return;
    }
    setConfirm(true);
  };

  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="compact-modal-header"><DialogTitle>{t('lmsPaymentAllocationTitle')}</DialogTitle></DialogHeader>
        <div className="compact-modal-body flex-1 space-y-3 overflow-y-auto overscroll-contain">
          <CompactModalSection title={t('lmsPaymentAllocationTotal')} icon={Banknote} tone="sky" collapsible={false}>
            <dl className="flex flex-wrap items-center justify-between gap-3">
              <dt>{t('lmsPaymentAllocationTotal')}</dt><dd className="font-semibold tabular-nums">{money(baseline.amountUzs)}</dd>
              <dt>{t('lmsPaymentAllocationRemaining')}</dt><dd className="tabular-nums">{money(baseline.amountUzs - total)}</dd>
            </dl>
          </CompactModalSection>
          <CompactModalSection title={t('students')} icon={Users} tone="teal" count={baseline.students.length} collapsible={false} disabled={save.isPending}>
            <div className="space-y-3">
              {baseline.students.length ? baseline.students.map(student => (
                <label key={student.id} className="grid min-w-0 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,180px)]">
                  <span className="break-words text-sm">{student.name}</span>
                  <CurrencyInput value={amounts[student.id]} onValueChange={value => setAmounts(current => ({ ...current, [student.id]: value }))} aria-label={student.name} disabled={save.isPending} />
                </label>
              )) : <p>{t('lmsPaymentAllocationEmpty')}</p>}
            </div>
          </CompactModalSection>
          <CompactModalSection title={t('lmsPaymentAllocationReason')} tone="violet" summary={reason} open={reasonOpen} onOpenChange={setReasonOpen} disabled={save.isPending}>
            <label className="grid gap-2">
              <span className="sr-only">{t('lmsPaymentAllocationReason')}</span>
              <Textarea ref={reasonRef} maxLength={2000} value={reason} aria-invalid={reasonInvalid && reason.trim().length < 3}
                onChange={event => setReason(event.target.value)} disabled={save.isPending} />
            </label>
            {reasonInvalid && reason.trim().length < 3 ? <p role="alert" className="mt-2 text-sm text-destructive">{t('lmsPaymentAllocationReasonRequired')}</p> : null}
          </CompactModalSection>
          {total > baseline.amountUzs ? <p role="alert" className="text-sm text-destructive">{t('lmsPaymentAllocationExceeds')}</p> : null}
          {save.isError ? <p role="alert" className="text-sm text-destructive">{t(save.error instanceof PortalFinanceApiError && save.error.status === 409 ? 'portalIdentityConflict' : 'portalSaveError')}</p> : null}
        </div>
        <DialogFooter className="compact-modal-footer">
          <Button variant="outline" disabled={save.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button>
          <Button loading={save.isPending} disabled={save.isPending || !dirty || total <= 0 || total > baseline.amountUzs} onClick={requestSave}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
    <AlertDialog open={confirm} onOpenChange={open => { if (!save.isPending) setConfirm(open); }} pending={save.isPending}>
      <AlertDialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0">
        <AlertDialogHeader className="compact-modal-header">
          <AlertDialogTitle>{t('lmsPaymentAllocationConfirm')}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>{baseline.students.filter(student => Number(amounts[student.id] || 0) > 0).map(student => `${student.name}: ${money(Number(amounts[student.id]))}`).join('; ')}</AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter className="compact-modal-footer">
          <AlertDialogCancel disabled={save.isPending}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={save.isPending} onClick={event => { event.preventDefault(); setConfirm(false); save.mutate(); }}>{(save.isPending) && <OrbitSpinner className="mr-1.5 size-4" />}{t('save')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

export function PaymentAllocationDialog({ paymentId, onClose, money }: {
  paymentId: number;
  onClose: () => void;
  money: (value: number) => string;
}) {
  const { t } = useTranslation();
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const finish = () => {
    onClose();
    setTimeout(() => { if (opener?.isConnected) opener.focus(); }, 0);
  };
  const query = useQuery({ queryKey: ['portal-finance', 'allocation', paymentId], queryFn: () => portalFinanceApi.allocation(paymentId), gcTime: 0 });
  if (query.data) return <AllocationForm context={query.data} onClose={finish} money={money} />;
  return <Dialog open onOpenChange={open => { if (!open) finish(); }}>
    <DialogContent aria-describedby={undefined} className="compact-modal gap-0 overflow-hidden p-0">
      <DialogHeader className="compact-modal-header"><DialogTitle>{t('lmsPaymentAllocationTitle')}</DialogTitle></DialogHeader>
      <div className="compact-modal-body">
        {query.isError ? <div role="alert"><p>{t('portalLoadError')}</p><Button onClick={() => void query.refetch()}>{t('retry')}</Button></div> : <p role="status"><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p>}
      </div>
    </DialogContent>
  </Dialog>;
}
