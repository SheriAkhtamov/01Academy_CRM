import { useId, useState } from 'react';
import { kpiConfigSchema, type KpiConfig, type KpiRole } from '@shared/sales-kpi';
import { calculateKpiPay } from '@shared/sales-kpi-pay';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KpiPayTable } from './KpiPayTable';
import { kpiMoney } from '../copy';

export function KpiSimulation({ role, config }: { role: KpiRole; config: KpiConfig }) {
  const { t, language } = useTranslation();
  const id = useId();
  const [values, setValues] = useState({ volume: role === 'hunter' ? 50 : 24, attendees: 35, conversion: role === 'hunter' ? 70 : 55, renewals: 14, upsells: 3, referrals: 0, reactivated: 0 });
  const [conditions, setConditions] = useState({ crm: true, timing: true });
  const parsed = kpiConfigSchema.safeParse(config);
  const lines = parsed.success ? calculateKpiPay(role, parsed.data, { ...values, baseConditions: { volume: values.volume >= parsed.data.minimumVolume, ...conditions } }) : null;
  const fields: { name: keyof typeof values; translationKey: TranslationKey; max?: number }[] = [
    { name: 'volume', translationKey: role === 'hunter' ? 'kpiMonthlyBookings' : 'kpiMonthlyStudents' },
    { name: 'conversion', translationKey: role === 'hunter' ? 'kpiTrialAttendanceTarget' : 'kpiTrialPaymentTarget', max: 100 },
  ];
  if (role === 'hunter') fields.push(
    { name: 'attendees', translationKey: 'kpiSimulationAttendance' },
    { name: 'reactivated', translationKey: 'kpiReactivatedAttendanceMetric' },
  );
  else fields.push(
    { name: 'renewals', translationKey: 'kpiRenewalsMetric' },
    { name: 'upsells', translationKey: 'kpiUpsellsMetric' },
    { name: 'referrals', translationKey: 'kpiReferralsMetric' },
  );
  return <section className="space-y-5" aria-label={t('kpiSalaryCalculator')}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(({ name, translationKey, max }) => <div key={name} className="space-y-1.5">
        <Label htmlFor={`${id}-${name}`} className="text-xs">{t(translationKey)}</Label>
        <Input id={`${id}-${name}`} type="number" min={0} max={max ?? 100_000} step={name === 'conversion' ? '0.1' : '1'} value={values[name]}
          onChange={(event) => { const value = Math.max(0, Math.min(max ?? 100_000, Number(event.target.value) || 0)); setValues((current) => ({ ...current, [name]: name === 'conversion' ? value : Math.floor(value) })); }} />
      </div>)}
    </div>
    {config.baseSalaryMode === 'conditional' ? <fieldset className="space-y-2 border-t pt-4"><legend className="text-sm font-medium">{t('kpiBaseConditions')}</legend><div className="flex flex-wrap gap-4">
      {(['crm', 'timing'] as const).map((condition) => <label key={condition} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={conditions[condition]} onChange={(event) => setConditions((current) => ({ ...current, [condition]: event.target.checked }))} />{(condition === 'crm' ? t('kpiCrmConditionMet') : t('kpiTimingConditionMet'))}</label>)}
    </div></fieldset> : null}
    {lines ? <>
      <div className="rounded-xl bg-primary/5 p-4" aria-live="polite"><p className="text-sm text-muted-foreground">{t('kpiSalaryTotal')}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{kpiMoney(lines.reduce((sum, line) => sum + line.amountUzs, 0), language)}</p></div>
      <KpiPayTable lines={lines} />
    </> : <p className="text-sm text-muted-foreground">{t('invalidData')}</p>}
  </section>;
}
