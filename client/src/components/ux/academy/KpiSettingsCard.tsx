import { z } from 'zod';
import type { TranslationKey } from '@/lib/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { useCeoCopy } from '@/hooks/useCeoCopy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

interface KpiSettingsCardProps {
  values: Partial<Record<KpiNumberSetting, string>>;
  errors: Partial<Record<KpiNumberSetting, string>>;
  onNumberChange: (key: KpiNumberSetting, value: string) => void;
  phoneVisibility: CompanySettings['salesPhoneVisibility'];
  onPhoneVisibilityChange: (value: CompanySettings['salesPhoneVisibility']) => void;
  isPending: boolean;
  onSave: () => void;
}

export function KpiSettingsCard({
  values,
  errors,
  onNumberChange,
  phoneVisibility,
  onPhoneVisibilityChange,
  isPending,
  onSave,
}: KpiSettingsCardProps) {
  const { t } = useTranslation();
  const ceoCopy = useCeoCopy();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{ceoCopy.settings.title}</CardTitle>
        <CardDescription>{ceoCopy.settings.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            ['targetRevenueMonthlyUzs', ceoCopy.settings.revenue, ceoCopy.settings.sum],
            ['targetNewLeadsMonthly', ceoCopy.settings.newLeads, ceoCopy.settings.leads],
            ['maxCacUzs', ceoCopy.settings.maxCac, ceoCopy.settings.sum],
            ['maxCplUzs', ceoCopy.settings.maxCpl, ceoCopy.settings.sum],
            ['targetRoas', ceoCopy.settings.roas, 'x'],
            ['targetAttendancePercent', ceoCopy.settings.attendance, '%'],
            ['targetNps', ceoCopy.settings.nps, ''],
          ].map(([key, label, suffix]) => {
            const numericKey = key as KpiNumberSetting;
            const bounds = KPI_FIELD_BOUNDS[numericKey];
            return <div key={numericKey} className="space-y-2 rounded-lg border border-border/70 p-4">
              <Label htmlFor={`kpi-${key}`}>{label}</Label>
              <div className="relative">
                <Input
                  id={`kpi-${key}`}
                  type="number"
                  min={bounds.min}
                  max={bounds.max}
                  aria-invalid={Boolean(errors[numericKey])}
                  value={values[numericKey] ?? ''}
                  onChange={(event) => onNumberChange(numericKey, event.target.value)}
                  className="pr-12"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{suffix}</span>
              </div>
              {errors[numericKey] ? (
                <p className="text-xs text-destructive" role="alert">{errors[numericKey]}</p>
              ) : null}
            </div>;
          })}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border/70 pt-5 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2 rounded-lg border border-border/70 p-4">
            <Label htmlFor="settings-phone-visibility">{ceoCopy.settings.phoneVisibility}</Label>
            <Select value={phoneVisibility} onValueChange={(value: CompanySettings['salesPhoneVisibility']) => onPhoneVisibilityChange(value)}>
              <SelectTrigger id="settings-phone-visibility"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="own_leads">{ceoCopy.settings.ownLeadsOnly}</SelectItem>
                <SelectItem value="mask_until_assigned">{ceoCopy.settings.maskUntilAssigned}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? t('saving') : ceoCopy.settings.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
