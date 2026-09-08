import { useId, useState } from 'react';
import { Calculator } from 'lucide-react';
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
  const parsed = kpiConfigSchema.safeParse(config);
  const lines = parsed.success ? calculateKpiPay(role, parsed.data, { ...values, baseConditions: { volume: true, crm: true, timing: true } }) : null;
  const fields: { name: keyof typeof values; translationKey: TranslationKey; max?: number }[] = [
    { name: 'volume', translationKey: 'kpiSimulationVolume' },
    { name: 'conversion', translationKey: 'kpiSimulationConversion', max: 100 },
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
  return <section className="space-y-4 rounded-xl border bg-muted/20 p-4 sm:p-5">
    <div className="flex items-center gap-2"><Calculator className="size-4 text-primary" aria-hidden="true" /><h3 className="font-semibold">{t('kpiSimulator')}</h3></div>
    <p className="text-xs leading-relaxed text-muted-foreground">{t('kpiSimulationHint')}</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(({ name, translationKey, max }) => <div key={name} className="space-y-1.5">
        <Label htmlFor={`${id}-${name}`} className="text-xs">{t(translationKey)}</Label>
        <Input id={`${id}-${name}`} type="number" min={0} max={max ?? 100_000} value={values[name]}
          onChange={(event) => setValues((current) => ({ ...current, [name]: Math.max(0, Math.min(max ?? 100_000, Number(event.target.value) || 0)) }))} />
      </div>)}
    </div>
    {lines ? <>
      <p className="text-2xl font-semibold tabular-nums">{kpiMoney(lines.reduce((sum, line) => sum + line.amountUzs, 0), language)}</p>
      <KpiPayTable lines={lines} />
    </> : <p className="text-sm text-muted-foreground">{t('invalidData')}</p>}
  </section>;
}
