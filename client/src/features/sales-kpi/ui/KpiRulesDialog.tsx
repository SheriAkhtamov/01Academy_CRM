import { useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useSaveKpiRules } from '../hooks';
import { metricKeys, roleKeys } from '../copy';
import { kpiDayKeys, kpiFieldLabel, kpiPlanFieldGroups, kpiPlanSectionKeys, kpiSectionForField, type KpiPlanSection } from '../config-fields';
import { kpiMonthLabel } from './KpiPlanSummary';

export function KpiRulesDialog({ version, minimumMonth, expectedVersionId, onClose }: {
  version: KpiPlanVersion; minimumMonth: string; expectedVersionId: number; onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const mutation = useSaveKpiRules();
  const form = useForm<KpiConfig>({ resolver: zodResolver(kpiConfigSchema), defaultValues: version.config, shouldFocusError: false });
  const tiers = useFieldArray({ control: form.control, name: 'tiers' });
  const initialMonth = version.effectiveMonth > minimumMonth ? version.effectiveMonth : minimumMonth;
  const [month, setMonth] = useState(initialMonth);
  const [monthError, setMonthError] = useState(false);
  const [section, setSection] = useState<KpiPlanSection>('targets');
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
    } catch { /* The draft remains available for retry. */ }
  }, (errors) => {
    const first = Object.keys(errors)[0];
    if (first) setSection(kpiSectionForField(first));
  });
  const fields = (items: typeof kpiPlanFieldGroups.targets) => <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {items.filter((field) => !field.role || field.role === version.role).map((field) => <div key={field.name} className="space-y-1.5">
      <Label htmlFor={`kpi-field-${field.name}`} className="text-sm">{t(kpiFieldLabel(field, version.role))}</Label>
      <Input id={`kpi-field-${field.name}`} type="number" min={field.min ?? 0} max={field.max ?? 1_000_000_000}
        step={field.name.endsWith('Percent') ? '0.1' : '1'} aria-invalid={Boolean(form.formState.errors[field.name])}
        aria-describedby={form.formState.errors[field.name] ? `kpi-error-${field.name}` : undefined}
        {...form.register(field.name, { valueAsNumber: true })} />
      {form.formState.errors[field.name] ? <p id={`kpi-error-${field.name}`} role="alert" className="text-xs text-destructive">{t('invalidData')}</p> : null}
    </div>)}
  </div>;
  const bonusFields = kpiPlanFieldGroups.pay.filter((field) => !['baseSalaryUzs', 'variableSalaryUzs', 'minimumVolume'].includes(field.name));
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12"><DialogTitle>{t('kpiEditPlan')} · {t(roleKeys[version.role])}</DialogTitle></DialogHeader>
        <form noValidate onSubmit={save} className="flex min-h-0 flex-1 flex-col" onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
        }}>
          <div className="shrink-0 border-b bg-muted/20 px-5 py-3">
            <div className="flex flex-wrap items-center gap-3"><Label htmlFor="kpi-effective-month">{t('kpiEffectiveMonth')}</Label>
              <Input id="kpi-effective-month" type="month" className="w-full sm:w-44" min={minimumMonth} value={month}
                aria-invalid={monthError} onChange={(event) => { setMonth(event.target.value); setMonthError(false); }} />
            </div>
            {monthError ? <p role="alert" className="mt-2 text-sm text-destructive">{t('kpiMonthMinimum').replace('{month}', kpiMonthLabel(minimumMonth, language))}</p> : null}
          </div>
          <Tabs value={section} onValueChange={(value) => setSection(value as KpiPlanSection)} className="flex min-h-0 flex-1 flex-col">
            <TabsList indicator="underline" className="h-auto w-full shrink-0 rounded-none border-b px-2 py-0" aria-label={t('kpiPlanSections')}>
              {(Object.keys(kpiPlanSectionKeys) as KpiPlanSection[]).map((key) => <TabsTrigger key={key} value={key} className="gap-2 py-3">
                {t(kpiPlanSectionKeys[key])}{Object.keys(form.formState.errors).some((field) => kpiSectionForField(field) === key) ? <span className="size-1.5 rounded-full bg-destructive" aria-label={t('invalidData')} /> : null}
              </TabsTrigger>)}
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
              <TabsContent value="targets" className="mt-0">{fields(kpiPlanFieldGroups.targets)}</TabsContent>
              <TabsContent value="pay" className="mt-0 space-y-6">
                {fields(kpiPlanFieldGroups.pay.filter((field) => ['baseSalaryUzs', 'variableSalaryUzs'].includes(field.name)))}
                <fieldset className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">{t('kpiBaseConditions')}</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{(['guaranteed', 'conditional'] as const).map((mode) => <label key={mode} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${values.baseSalaryMode === mode ? 'border-primary/50 bg-primary/5' : ''}`}>
                    <input type="radio" className="size-4 accent-primary" name="kpi-salary-mode" value={mode} checked={values.baseSalaryMode === mode} onChange={() => form.setValue('baseSalaryMode', mode, { shouldDirty: true })} />
                    {(mode === 'guaranteed' ? t('kpiGuaranteedShort') : t('kpiConditionalShort'))}
                  </label>)}</div>
                  {fields(kpiPlanFieldGroups.pay.filter((field) => field.name === 'minimumVolume'))}
                </fieldset>
                <section className="space-y-3"><h3 className="text-sm font-semibold">{(version.role === 'hunter' ? t('kpiTrialBonus') : t('kpiStudentBonus'))}</h3>
                  {tiers.fields.map((tier, index) => <div key={tier.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-end gap-2 rounded-lg bg-muted/30 p-3">
                    <div className="space-y-1.5"><Label htmlFor={`tier-from-${tier.id}`} className="text-xs">{t('kpiTierFrom')}</Label><Input id={`tier-from-${tier.id}`} type="number" min={1} readOnly={index === 0} aria-invalid={Boolean(form.formState.errors.tiers?.[index]?.from)} {...form.register(`tiers.${index}.from`, { valueAsNumber: true })} /></div>
                    <div className="space-y-1.5"><Label htmlFor={`tier-rate-${tier.id}`} className="text-xs">{t('kpiTierRate')}</Label><Input id={`tier-rate-${tier.id}`} type="number" min={0} aria-invalid={Boolean(form.formState.errors.tiers?.[index]?.rateUzs)} {...form.register(`tiers.${index}.rateUzs`, { valueAsNumber: true })} /></div>
                    <Button type="button" variant="ghost" size="icon" disabled={index === 0} aria-label={t('kpiRemoveTier')} onClick={() => setRemoveIndex(index)}><Trash2 className="size-4" /></Button>
                  </div>)}
                  {form.formState.errors.tiers ? <p role="alert" className="text-xs text-destructive">{t('invalidData')}</p> : null}
                  <Button type="button" variant="outline" size="sm" disabled={tiers.fields.length >= 12} onClick={() => tiers.append({ from: (Number(values.tiers.at(-1)?.from) || 1) + 10, rateUzs: values.tiers.at(-1)?.rateUzs ?? 0 })}><Plus className="mr-2 size-4" />{t('kpiAddTier')}</Button>
                </section>
                <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">{t('kpiAdditionalBonuses')}</h3>{fields(bonusFields)}
                  {version.role === 'hunter' ? <div className="flex items-center justify-between gap-3"><Label htmlFor="kpi-quality-inclusive">{t('kpiQualityEqual').replace('{percent}', String(values.qualityThresholdPercent || 0))}</Label><Switch id="kpi-quality-inclusive" checked={values.qualityThresholdInclusive} onCheckedChange={(value) => form.setValue('qualityThresholdInclusive', value, { shouldDirty: true })} /></div> : null}
                </section>
              </TabsContent>
              <TabsContent value="work" className="mt-0 space-y-5">
                {fields(kpiPlanFieldGroups.work)}
                <fieldset className="space-y-3 border-t pt-4"><legend className="text-sm font-semibold">{t('kpiWorkdays')}</legend>
                  <div className="flex flex-wrap gap-2">{kpiDayKeys.map((key, index) => <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${values.workdays.includes(index + 1) ? 'border-primary/40 bg-primary/5' : ''}`}>
                    <Checkbox checked={values.workdays.includes(index + 1)} onCheckedChange={(checked) => form.setValue('workdays', checked ? [...values.workdays, index + 1].sort() : values.workdays.filter((day) => day !== index + 1), { shouldDirty: true, shouldValidate: true })} />{t(key)}
                  </label>)}</div>
                  {form.formState.errors.workdays ? <p role="alert" className="text-xs text-destructive">{t('fieldRequired')}</p> : null}
                </fieldset>
              </TabsContent>
              <TabsContent value="display" className="mt-0"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROLE_METRICS[version.role].map((metric) => <label key={metric} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                  <Checkbox checked={values.enabledMetrics.includes(metric)} onCheckedChange={(checked) => form.setValue('enabledMetrics', checked ? [...values.enabledMetrics, metric] : values.enabledMetrics.filter((id) => id !== metric), { shouldDirty: true, shouldValidate: true })} />{t(metricKeys[metric])}
                </label>)}
              </div>{form.formState.errors.enabledMetrics ? <p role="alert" className="mt-2 text-xs text-destructive">{t('fieldRequired')}</p> : null}</TabsContent>
            </div>
          </Tabs>
          {mutation.isError ? <p role="alert" className="shrink-0 px-5 pb-3 text-sm text-destructive">{mutation.error.message === t('kpiVersionConflict') ? t('kpiVersionConflict') : t('kpiRequestFailed')}</p> : null}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-background px-5 py-4">
            <div className="flex gap-2"><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button><Button type="submit" disabled={mutation.isPending}>{t(mutation.isPending ? 'saving' : 'save')}</Button></div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={removeIndex !== null} onOpenChange={(open) => { if (!open) setRemoveIndex(null); }} title={t('kpiRemoveTier')} description={t('kpiRemoveTierConfirm')} confirmLabel={t('delete')} cancelLabel={t('cancel')} variant="destructive"
      onConfirm={() => { if (removeIndex !== null) tiers.remove(removeIndex); setRemoveIndex(null); }} />
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
