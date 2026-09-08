import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
    <Dialog open onOpenChange={guard.handleOpenChange}><DialogContent className="max-w-4xl">
      <DialogHeader><DialogTitle>{t('kpiCompanySettings')}</DialogTitle><DialogDescription>{t('kpiCompanySettingsHint')}</DialogDescription></DialogHeader>
      <KpiSettingsCard values={values} errors={errors} phoneVisibility={phoneVisibility} onPhoneVisibilityChange={setPhoneVisibility}
        onNumberChange={(key, value) => { setValues((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined })); }}
        isPending={mutation.isPending} onSave={async () => {
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
        }} />
      {mutation.isError ? <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p> : null}
    </DialogContent></Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}

export function CompanyTargetsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const query = useCompanyTargets();
  if (query.data) return <TargetsForm initial={{ ...DEFAULT_COMPANY_SETTINGS, ...query.data }} onClose={onClose} />;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t('kpiCompanySettings')}</DialogTitle><DialogDescription>{query.isError ? t('failedToLoadData') : t('loading')}</DialogDescription></DialogHeader>
    {query.isError ? <Button variant="outline" onClick={() => query.refetch()}>{t('retry')}</Button> : null}
  </DialogContent></Dialog>;
}
