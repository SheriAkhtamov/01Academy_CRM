import { z } from 'zod';
import type { TranslationKey } from '@/lib/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CompanySettings {
  targetRevenueMonthlyUzs: number;
  targetNewLeadsMonthly: number;
  maxCacUzs: number;
  maxCplUzs: number;
  targetRoas: number;
  targetAttendancePercent: number;
  targetNps: number;
  salesPhoneVisibility: 'own_leads' | 'mask_until_assigned';
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  targetRevenueMonthlyUzs: 0,
  targetNewLeadsMonthly: 0,
  maxCacUzs: 300000,
  maxCplUzs: 0,
  targetRoas: 5,
  targetAttendancePercent: 70,
  targetNps: 50,
  salesPhoneVisibility: 'own_leads',
};

export type KpiNumberSetting = 'targetRevenueMonthlyUzs' | 'targetNewLeadsMonthly' | 'maxCacUzs' | 'maxCplUzs' | 'targetRoas' | 'targetAttendancePercent' | 'targetNps';

export const KPI_FIELD_BOUNDS: Record<KpiNumberSetting, { min: number; max?: number }> = {
  targetRevenueMonthlyUzs: { min: 0 },
  targetNewLeadsMonthly: { min: 0 },
  maxCacUzs: { min: 0 },
  maxCplUzs: { min: 0 },
  targetRoas: { min: 0 },
  targetAttendancePercent: { min: 0, max: 100 },
  targetNps: { min: -100, max: 100 },
};

export const createKpiFieldSchema = (
  t: (key: TranslationKey) => string,
  bounds: { min: number; max?: number },
) => z.string().trim()
  .min(1, t('fieldRequired'))
  .refine((raw) => /^-?\d+(\.\d+)?$/.test(raw), t('invalidDataFormat'))
  .refine(
    (raw) => Number(raw) >= bounds.min,
    t('valueMustBeAtLeast').replace('{min}', String(bounds.min)),
  )
  .refine(
    (raw) => bounds.max === undefined || Number(raw) <= bounds.max,
    t('valueMustBeAtMost').replace('{max}', String(bounds.max)),
  );

const groups = [
  { titleKey: 'kpiPlanTargets', fields: [
    { key: 'targetRevenueMonthlyUzs', translationKey: 'targetMonthlyRevenue', unitKey: 'currencyUzs' },
    { key: 'targetNewLeadsMonthly', translationKey: 'targetMonthlyNewLeads', unitKey: 'leadCountMany' },
  ] },
  { titleKey: 'kpiMarketingTargets', fields: [
    { key: 'maxCacUzs', translationKey: 'kpiCacLabel', unitKey: 'currencyUzs' },
    { key: 'maxCplUzs', translationKey: 'kpiCplLabel', unitKey: 'currencyUzs' },
    { key: 'targetRoas', translationKey: 'kpiRoasLabel', suffix: '×' },
  ] },
  { titleKey: 'kpiServiceTargets', fields: [
    { key: 'targetAttendancePercent', translationKey: 'targetAttendance', suffix: '%' },
    { key: 'targetNps', translationKey: 'targetNps' },
  ] },
] satisfies { titleKey: TranslationKey; fields: { key: KpiNumberSetting; translationKey: TranslationKey; unitKey?: TranslationKey; suffix?: string }[] }[];

export function KpiSettingsCard({ values, errors, onNumberChange, phoneVisibility, onPhoneVisibilityChange }: {
  values: Partial<Record<KpiNumberSetting, string>>;
  errors: Partial<Record<KpiNumberSetting, string>>;
  onNumberChange: (key: KpiNumberSetting, value: string) => void;
  phoneVisibility: CompanySettings['salesPhoneVisibility'];
  onPhoneVisibilityChange: (value: CompanySettings['salesPhoneVisibility']) => void;
}) {
  const { t } = useTranslation();
  return <div className="space-y-6">
    {groups.map((group) => <fieldset key={group.titleKey} className="space-y-3">
      <legend className="mb-3 text-sm font-semibold">{t(group.titleKey)}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{group.fields.map((field) => {
        const bounds = KPI_FIELD_BOUNDS[field.key];
        return <div key={field.key} className="space-y-2">
          <Label htmlFor={`kpi-${field.key}`}>{t(field.translationKey)}</Label>
          <div className="relative"><Input id={`kpi-${field.key}`} type="number" min={bounds.min} max={bounds.max}
            step={['targetRoas', 'targetAttendancePercent', 'targetNps'].includes(field.key) ? '0.1' : '1'}
            aria-invalid={Boolean(errors[field.key])} aria-describedby={errors[field.key] ? `error-${field.key}` : undefined}
            value={values[field.key] ?? ''} onChange={(event) => onNumberChange(field.key, event.target.value)} className="pr-14" />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{'unitKey' in field && field.unitKey ? t(field.unitKey) : 'suffix' in field ? field.suffix : null}</span>
          </div>
          {errors[field.key] ? <p id={`error-${field.key}`} className="text-xs text-destructive" role="alert">{errors[field.key]}</p> : null}
        </div>;
      })}</div>
    </fieldset>)}
    <div className="space-y-2 border-t pt-5">
      <Label htmlFor="settings-phone-visibility">{t('salesLeadVisibility')}</Label>
      <select id="settings-phone-visibility" className="h-11 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={phoneVisibility} onChange={(event) => onPhoneVisibilityChange(event.target.value as CompanySettings['salesPhoneVisibility'])}>
        <option value="own_leads">{t('ownAndUnassignedLeads')}</option><option value="mask_until_assigned">{t('maskLeadsUntilAssigned')}</option>
      </select>
    </div>
  </div>;
}
