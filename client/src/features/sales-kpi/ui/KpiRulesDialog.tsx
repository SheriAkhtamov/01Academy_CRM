import { useState } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { ROLE_METRICS, kpiConfigSchema, kpiMonthSchema, type KpiConfig, type KpiPlanVersion } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import ConfirmDialog from '@/components/ConfirmDialog';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useSaveKpiRules } from '../hooks';
import { metricKeys, roleKeys } from '../copy';
import { kpiDayKeys, kpiPayFields, kpiScheduleFields, kpiTargetFields } from '../config-fields';
import { KpiSimulation } from './KpiSimulation';

export function KpiRulesDialog({ version, minimumMonth, expectedVersionId, onClose }: {
  version: KpiPlanVersion; minimumMonth: string; expectedVersionId: number; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const mutation = useSaveKpiRules();
  const form = useForm<KpiConfig>({ resolver: zodResolver(kpiConfigSchema), defaultValues: version.config });
  const tiers = useFieldArray({ control: form.control, name: 'tiers' });
  const initialMonth = version.effectiveMonth > minimumMonth ? version.effectiveMonth : minimumMonth;
  const [month, setMonth] = useState(initialMonth);
  const [monthError, setMonthError] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const values = form.watch();
  const guard = useUnsavedChangesGuard({ open: true, isDirty: form.formState.isDirty || month !== initialMonth,
    onOpenChange: (open) => { if (!open && !mutation.isPending) onClose(); } });
  const save = form.handleSubmit(async (config) => {
    if (mutation.isPending) return;
    if (!kpiMonthSchema.safeParse(month).success || month < minimumMonth) { setMonthError(true); return; }
    try {
      await mutation.mutateAsync({ role: version.role, config, effectiveMonth: month, expectedVersionId });
      toast({ title: t('kpiSaved') });
      onClose();
    } catch { /* The inline error preserves the draft for correction/retry. */ }
  });
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>{t('kpiEditRules')} · {t(roleKeys[version.role])}</DialogTitle>
          <DialogDescription>{t('kpiEditRulesDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
        }}>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
            <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
              <Label htmlFor="kpi-effective-month">{t('kpiEffectiveMonth')}</Label>
              <Input id="kpi-effective-month" type="month" min={minimumMonth} value={month}
                aria-invalid={monthError} onChange={(event) => { setMonth(event.target.value); setMonthError(false); }} />
              <p className="text-xs text-muted-foreground">{t('kpiFutureRulesHint')}</p>
              {monthError ? <p role="alert" className="text-sm text-destructive">{t('kpiFutureRulesRequired')}</p> : null}
            </div>
            {([
              { translationKey: 'kpiPaySettings', fields: kpiPayFields },
              { translationKey: 'kpiTargetsSettings', fields: kpiTargetFields },
              { translationKey: 'kpiScheduleSettings', fields: kpiScheduleFields },
            ] satisfies { translationKey: TranslationKey; fields: typeof kpiPayFields }[]).map((group) => <section key={group.translationKey} className="space-y-3">
              <h3 className="font-semibold">{t(group.translationKey)}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {group.fields.filter((field) => !field.role || field.role === version.role).map((field) => <div key={field.name} className="space-y-1.5">
                  <Label htmlFor={`kpi-field-${field.name}`} className="text-xs">{t(field.translationKey)}</Label>
                  <Input id={`kpi-field-${field.name}`} type="number" min={field.min ?? 0} max={field.max ?? 1_000_000_000}
                    step={field.name.endsWith('Percent') ? '0.1' : '1'} aria-invalid={Boolean(form.formState.errors[field.name])}
                    {...form.register(field.name, { valueAsNumber: true })} />
                  {form.formState.errors[field.name] ? <p role="alert" className="text-xs text-destructive">{t('invalidData')}</p> : null}
                </div>)}
              </div>
              {group.translationKey === 'kpiPaySettings' ? <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-1.5"><Label htmlFor="kpi-salary-mode">{t('kpiBaseSalaryMode')}</Label>
                  <Select value={values.baseSalaryMode} onValueChange={(value: KpiConfig['baseSalaryMode']) => form.setValue('baseSalaryMode', value, { shouldDirty: true })}>
                    <SelectTrigger id="kpi-salary-mode"><SelectValue /></SelectTrigger><SelectContent>
                      <SelectItem value="guaranteed">{t('kpiGuaranteed')}</SelectItem><SelectItem value="conditional">{t('kpiConditional')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {version.role === 'hunter' ? <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="kpi-quality-inclusive">{t('kpiQualityInclusive')}</Label>
                  <Switch id="kpi-quality-inclusive" checked={values.qualityThresholdInclusive}
                    onCheckedChange={(value) => form.setValue('qualityThresholdInclusive', value, { shouldDirty: true })} />
                </div> : null}
              </div> : null}
              {group.translationKey === 'kpiScheduleSettings' ? <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('kpiWorkdays')}</legend>
                <div className="flex flex-wrap gap-3">{kpiDayKeys.map((key, index) => <label key={key} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Checkbox checked={values.workdays.includes(index + 1)} onCheckedChange={(checked) => form.setValue('workdays',
                    checked ? [...values.workdays, index + 1].sort() : values.workdays.filter((day) => day !== index + 1), { shouldDirty: true, shouldValidate: true })} />
                  {t(key)}
                </label>)}</div>
                {form.formState.errors.workdays ? <p role="alert" className="text-xs text-destructive">{t('fieldRequired')}</p> : null}
                <p className="text-xs text-muted-foreground">{t('kpiTimezone')}</p>
              </fieldset> : null}
            </section>)}
            <section className="space-y-3">
              <h3 className="font-semibold">{t('kpiTiers')}</h3><p className="text-xs leading-relaxed text-muted-foreground">{t('kpiTiersHint')}</p>
              {tiers.fields.map((tier, index) => <div key={tier.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-lg border p-3">
                <div className="space-y-1.5"><Label htmlFor={`tier-from-${tier.id}`} className="text-xs">{t('kpiTierFrom')}</Label>
                  <Input id={`tier-from-${tier.id}`} type="number" min={1} readOnly={index === 0} aria-invalid={Boolean(form.formState.errors.tiers?.[index]?.from)} {...form.register(`tiers.${index}.from`, { valueAsNumber: true })} />
                </div>
                <div className="space-y-1.5"><Label htmlFor={`tier-rate-${tier.id}`} className="text-xs">{t('kpiTierRate')}</Label>
                  <Input id={`tier-rate-${tier.id}`} type="number" min={0} aria-invalid={Boolean(form.formState.errors.tiers?.[index]?.rateUzs)} {...form.register(`tiers.${index}.rateUzs`, { valueAsNumber: true })} />
                </div>
                <Button type="button" variant="ghost" size="icon" disabled={index === 0} aria-label={t('kpiRemoveTier')} onClick={() => setRemoveIndex(index)}><Trash2 className="size-4" /></Button>
              </div>)}
              {form.formState.errors.tiers ? <p role="alert" className="text-xs text-destructive">{t('invalidData')}</p> : null}
              <Button type="button" variant="outline" size="sm" disabled={tiers.fields.length >= 12} onClick={() => tiers.append({ from: (Number(values.tiers.at(-1)?.from) || 1) + 10, rateUzs: values.tiers.at(-1)?.rateUzs ?? 0 })}><Plus className="mr-2 size-4" />{t('kpiAddTier')}</Button>
            </section>
            <fieldset className="space-y-3"><legend className="font-semibold">{t('kpiMetricsSettings')}</legend>
              <p className="text-xs text-muted-foreground">{t('kpiMetricsHint')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{ROLE_METRICS[version.role].map((metric) => <label key={metric} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <Checkbox checked={values.enabledMetrics.includes(metric)} onCheckedChange={(checked) => form.setValue('enabledMetrics',
                  checked ? [...values.enabledMetrics, metric] : values.enabledMetrics.filter((id) => id !== metric), { shouldDirty: true, shouldValidate: true })} />{t(metricKeys[metric])}
              </label>)}</div>
              {form.formState.errors.enabledMetrics ? <p role="alert" className="text-xs text-destructive">{t('fieldRequired')}</p> : null}
            </fieldset>
            <KpiSimulation role={version.role} config={values} />
            {mutation.isError ? <Alert variant="destructive"><AlertDescription>{mutation.error.message}</AlertDescription></Alert> : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-5 py-4">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button>
            <Button type="submit" disabled={mutation.isPending}>{t(mutation.isPending ? 'saving' : 'save')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={removeIndex !== null} onOpenChange={(open) => { if (!open) setRemoveIndex(null); }}
      title={t('kpiRemoveTier')} description={t('kpiRemoveTierConfirm')} confirmLabel={t('delete')} cancelLabel={t('cancel')} variant="destructive"
      onConfirm={() => { if (removeIndex !== null) tiers.remove(removeIndex); setRemoveIndex(null); }} />
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
