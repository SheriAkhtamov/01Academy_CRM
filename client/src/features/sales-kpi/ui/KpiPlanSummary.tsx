import type { KpiConfig, KpiRole } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { kpiMoney, metricKeys } from '../copy';
import { kpiDayKeys, kpiFieldLabel, kpiPlanFieldGroups, kpiPlanSectionKeys } from '../config-fields';

export const kpiMonthLabel = (month: string, language: string) => new Intl.DateTimeFormat(language, {
  month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${month}-01T00:00:00Z`));

export function KpiPlanSummary({ config, role, full = false }: { config: KpiConfig; role: KpiRole; full?: boolean }) {
  const { t, language } = useTranslation();
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-4 border-b border-border/60 pb-5">
      <div><p className="text-xs text-muted-foreground">{(role === 'hunter' ? t('kpiMonthlyBookings') : t('kpiMonthlyStudents'))}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{config.volumeTarget}</p></div>
      <div><p className="text-xs text-muted-foreground">{t(role === 'hunter' ? 'kpiAttendanceMetric' : 'kpiTrialConversionMetric')}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{config.conversionTargetPercent}%</p></div>
    </div>
    <dl className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-muted-foreground">{t('kpiPayBase')}</dt><dd className="font-medium tabular-nums">{kpiMoney(config.baseSalaryUzs, language)}</dd></div>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-muted-foreground">{t('kpiPayVariable')}</dt><dd className="font-medium tabular-nums">{kpiMoney(config.variableSalaryUzs, language)}</dd></div>
    </dl>
    <div><h4 className="mb-2 text-sm font-medium">{(role === 'hunter' ? t('kpiTrialBonus') : t('kpiStudentBonus'))}</h4>
      <dl className="divide-y divide-border/50 rounded-lg bg-muted/30 px-3">{config.tiers.map((tier, index) => <div key={tier.from} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
        <dt className="text-muted-foreground">{config.tiers[index + 1] ? `${tier.from}–${config.tiers[index + 1].from - 1}` : `${tier.from}+`}</dt><dd className="font-medium tabular-nums">{kpiMoney(tier.rateUzs, language)}</dd>
      </div>)}</dl>
    </div>
    {full ? <div className="space-y-5 border-t pt-5">{Object.entries(kpiPlanFieldGroups).map(([section, fields]) => <section key={section} className="space-y-2">
      <h4 className="font-semibold">{t(kpiPlanSectionKeys[section as keyof typeof kpiPlanFieldGroups])}</h4>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{fields.filter((field) => !field.role || field.role === role).map((field) => <div key={field.name} className="flex items-baseline justify-between gap-3 border-b border-border/40 py-2">
        <dt className="text-muted-foreground">{t(kpiFieldLabel(field, role))}</dt><dd className="shrink-0 font-medium tabular-nums">{new Intl.NumberFormat(language).format(config[field.name])}</dd>
      </div>)}</dl>
    </section>)}
      <dl className="space-y-3 border-t pt-4 text-sm">
        <div><dt className="text-muted-foreground">{t('kpiBaseConditions')}</dt><dd className="mt-1 font-medium">{config.baseSalaryMode === 'guaranteed' ? t('kpiGuaranteedShort') : t('kpiConditionalShort')}</dd></div>
        {role === 'hunter' ? <div><dt className="text-muted-foreground">{t('kpiQualityEqual').replace('{percent}', String(config.qualityThresholdPercent))}</dt><dd className="mt-1 font-medium">{config.qualityThresholdInclusive ? t('yes') : t('no')}</dd></div> : null}
        <div><dt className="text-muted-foreground">{t('kpiWorkdays')}</dt><dd className="mt-1 font-medium">{config.workdays.map((day) => t(kpiDayKeys[day - 1])).join(', ')}</dd></div>
        <div><dt className="text-muted-foreground">{t('kpiDashboardDisplay')}</dt><dd className="mt-1 font-medium">{config.enabledMetrics.map((metric) => t(metricKeys[metric])).join(', ')}</dd></div>
      </dl>
    </div> : null}
  </div>;
}
