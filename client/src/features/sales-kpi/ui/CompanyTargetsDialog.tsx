import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DEFAULT_COMPANY_SETTINGS, KPI_FIELD_BOUNDS, KpiSettingsCard, createKpiFieldSchema, type CompanySettings, type KpiNumberSetting } from '@/components/ux/academy/KpiSettingsCard';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useCompanyTargets, useSaveCompanyTargets } from '../hooks';

function TargetsForm({ initial, onClose }: { initial: CompanySettings; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const mutation = useSaveCompanyTargets();
  const [phoneVisibility, setPhoneVisibility] = useState(initial.salesPhoneVisibility);
  const [values, setValues] = useState(() => Object.fromEntries(Object.keys(KPI_FIELD_BOUNDS).map((key) => [key, String(initial[key as KpiNumberSetting])]))) ;
  const [errors, setErrors] = useState<Partial<Record<KpiNumberSetting, string>>>({});
  const dirty = phoneVisibility !== initial.salesPhoneVisibility || Object.keys(KPI_FIELD_BOUNDS).some((key) => values[key] !== String(initial[key as KpiNumberSetting]));
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, onOpenChange: (open) => { if (!open && !mutation.isPending) onClose(); } });
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}><DialogContent className="flex max-w-3xl flex-col gap-0 overflow-hidden p-0" aria-describedby={undefined}>
      <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12"><DialogTitle>{t('kpiCompanyGoals')}</DialogTitle></DialogHeader>
      <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={async (event) => {
          event.preventDefault();
          if (mutation.isPending) return;
          const next: Partial<Record<KpiNumberSetting, string>> = {};
          const payload = { ...initial, salesPhoneVisibility: phoneVisibility };
          for (const key of Object.keys(KPI_FIELD_BOUNDS) as KpiNumberSetting[]) {
            const parsed = createKpiFieldSchema(t, KPI_FIELD_BOUNDS[key]).safeParse(values[key]);
            if (!parsed.success) next[key] = parsed.error.issues[0]?.message ?? t('invalidData');
            else payload[key] = Number(parsed.data);
          }
          setErrors(next);
          if (Object.keys(next).length) return;
          try { await mutation.mutateAsync(payload); toast({ title: t('ceoGoalsSaved') }); onClose(); } catch { /* Preserve the draft. */ }
        }}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <KpiSettingsCard values={values} errors={errors} phoneVisibility={phoneVisibility} onPhoneVisibilityChange={setPhoneVisibility}
            onNumberChange={(key, value) => { setValues((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined })); }} />
          {mutation.isError ? <p role="alert" className="mt-4 text-sm text-destructive">{t('ceoGoalsSaveFailed')}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4"><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button><Button type="submit" disabled={mutation.isPending}>{t(mutation.isPending ? 'saving' : 'saveGoals')}</Button></div>
      </form>
    </DialogContent></Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}

export function CompanyTargetsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const query = useCompanyTargets();
  if (query.data) return <TargetsForm initial={{ ...DEFAULT_COMPANY_SETTINGS, ...query.data }} onClose={onClose} />;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent aria-describedby={undefined}>
    <DialogHeader><DialogTitle>{t('kpiCompanyGoals')}</DialogTitle></DialogHeader><p role="status">{query.isError ? t('failedToLoadData') : t('loading')}</p>
    {query.isError ? <Button variant="outline" onClick={() => query.refetch()}>{t('retry')}</Button> : null}
  </DialogContent></Dialog>;
}
