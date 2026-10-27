import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Undo2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLeadQualification } from '../qualification';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import ConfirmDialog from '@/components/ConfirmDialog';

export function LeadQualificationAction({ leadId, funnelId, disabled = false }: {
  leadId: number; funnelId: number; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { query, mutation } = useLeadQualification(leadId, funnelId);
  const [open, setOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [criteria, setCriteria] = useState({ locationFits: false, ageFits: false, budgetFits: false });
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reset = () => setCriteria({ locationFits: false, ageFits: false, budgetFits: false });
  const guard = useUnsavedChangesGuard({ open, isDirty: Object.values(criteria).some(Boolean),
    isPending: mutation.isPending, onOpenChange: setOpen, onDiscard: reset });
  const denied = query.isError && [403, 404].includes(Number((query.error as { status?: number }).status));
  useEffect(() => {
    if (disabled || denied || (query.data && query.data.funnelId !== funnelId)) { setOpen(false); setRevokeOpen(false); }
  }, [disabled, denied, query.data, funnelId]);

  const save = async (qualify: boolean) => {
    if (submitting.current || disabled || denied || query.data?.funnelId !== funnelId) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync(qualify
        ? { funnelId, locationFits: true, ageFits: true, budgetFits: true }
        : { funnelId, qualifiedAt: query.data!.qualifiedAt! });
      if (!mounted.current) return;
      reset(); setOpen(false); setRevokeOpen(false);
    } catch {
      // Preserve the checklist and dialog for a retry after a network error.
    } finally { submitting.current = false; }
  };
  const qualified = !query.isError && Boolean(query.data?.qualifiedAt);
  if (denied) return null;
  return <>
    {query.isError ? <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>{t('retry')}</Button> : qualified ?
      <span className="inline-flex items-center gap-1">
        <Badge variant="secondary" className="gap-1"><BadgeCheck className="size-3.5" aria-hidden="true" />{t('salesQualified')}</Badge>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('salesRevokeQualification')} disabled={disabled || mutation.isPending}
          onClick={() => { mutation.reset(); setRevokeOpen(true); }}><Undo2 className="size-3.5" aria-hidden="true" /></Button>
      </span> : <Button type="button" variant="outline" size="sm" disabled={disabled || query.isPending || mutation.isPending}
        onClick={() => { reset(); mutation.reset(); setOpen(true); }}><BadgeCheck data-icon="inline-start" />{t('salesQualifyLead')}</Button>}
    <Dialog open={open && !denied} onOpenChange={guard.handleOpenChange}>
      <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden p-0" aria-describedby={undefined}
        onEscapeKeyDown={(event) => { if (mutation.isPending) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (mutation.isPending) event.preventDefault(); }}>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); if (Object.values(criteria).every(Boolean)) void save(true); }}>
          <DialogHeader className="compact-modal-header"><DialogTitle>{t('salesQualifyLead')}</DialogTitle></DialogHeader>
          <div className="compact-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <CompactModalSection title={t('salesQualificationCriteria')} icon={BadgeCheck} tone="teal" collapsible={false}>
              <div className="space-y-3">{([
                ['locationFits', 'salesQualificationLocation'], ['ageFits', 'salesQualificationAge'], ['budgetFits', 'salesQualificationBudget'],
              ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm" htmlFor={`qualification-${leadId}-${key}`}>
                <Checkbox id={`qualification-${leadId}-${key}`} checked={criteria[key]} disabled={mutation.isPending}
                  onCheckedChange={(checked) => setCriteria((previous) => ({ ...previous, [key]: checked === true }))} />
                {t(label)}
              </label>)}</div>
            </CompactModalSection>
            {mutation.isError ? <p role="alert" className="mt-3 text-sm text-destructive">{t('leadQualificationFailed')}</p> : null}
          </div>
          <DialogFooter className="compact-modal-footer">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button>
            <Button loading={mutation.isPending} type="submit" disabled={mutation.isPending || !Object.values(criteria).every(Boolean)}>{t('salesQualifyLead')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} isPending={mutation.isPending} />
    <ConfirmDialog open={revokeOpen && !denied} onOpenChange={setRevokeOpen} title={t('salesRevokeQualification')}
      description={mutation.isError ? t('leadQualificationFailed') : t('salesRevokeQualificationConfirm')}
      confirmLabel={t('salesRevokeQualification')} variant="destructive" isPending={mutation.isPending} keepOpenOnConfirm onConfirm={() => save(false)} />
  </>;
}
