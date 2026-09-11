import type { KpiConfig, SingleKpiRole } from '@shared/sales-kpi';
import type { TranslationKey } from '@/lib/i18n';

export type KpiNumberField = { [K in keyof KpiConfig]: KpiConfig[K] extends number ? K : never }[keyof KpiConfig];
type Field = { name: KpiNumberField; translationKey: TranslationKey; min?: number; max?: number; role?: SingleKpiRole };
export type KpiPlanSection = 'targets' | 'pay' | 'work' | 'display';
export const kpiPayFields: Field[] = [
  { name: 'baseSalaryUzs', translationKey: 'kpiBaseSalary' }, { name: 'variableSalaryUzs', translationKey: 'kpiVariableSalary' },
  { name: 'qualityBonusUzs', translationKey: 'kpiQualityBonus', role: 'hunter' },
  { name: 'qualityThresholdPercent', translationKey: 'kpiQualityThreshold', max: 100, role: 'hunter' },
  { name: 'reactivationBonusUzs', translationKey: 'kpiReactivationBonus', role: 'hunter' },
  { name: 'renewalBonusUzs', translationKey: 'kpiRenewalBonus', role: 'closer' },
  { name: 'upsellBonusUzs', translationKey: 'kpiUpsellBonus', role: 'closer' },
  { name: 'referralBonusUzs', translationKey: 'kpiReferralBonus', role: 'closer' },
];
export const kpiTargetFields: Field[] = [
  { name: 'minimumVolume', translationKey: 'kpiMinimumVolume' }, { name: 'volumeTarget', translationKey: 'kpiVolumeTarget', min: 1 },
  { name: 'conversionTargetPercent', translationKey: 'kpiConversionTarget', max: 100 }, { name: 'crmTargetPercent', translationKey: 'kpiCrmTarget', max: 100 },
  { name: 'qualifiedTarget', translationKey: 'kpiQualifiedTarget', role: 'hunter' },
  { name: 'responseTargetMinutes', translationKey: 'kpiResponseTarget', min: 1, max: 1440, role: 'hunter' },
  { name: 'responseBaseMinutes', translationKey: 'kpiResponseBase', min: 1, max: 1440, role: 'hunter' },
  { name: 'reactivationDays', translationKey: 'kpiReactivationDays', min: 1, max: 365, role: 'hunter' },
  { name: 'offerNextDayHour', translationKey: 'kpiOfferDeadline', max: 23, role: 'closer' },
  { name: 'conversionWindowDays', translationKey: 'kpiConversionWindow', min: 1, max: 365, role: 'closer' },
  { name: 'renewalTargetPercent', translationKey: 'kpiRenewalTarget', max: 100, role: 'closer' },
  { name: 'upsellTarget', translationKey: 'kpiUpsellTarget', role: 'closer' },
  { name: 'npsTarget', translationKey: 'kpiNpsTarget', min: -100, max: 100, role: 'closer' },
];
export const kpiScheduleFields: Field[] = [
  { name: 'workdayStartHour', translationKey: 'kpiWorkdayStart', max: 23 }, { name: 'workdayEndHour', translationKey: 'kpiWorkdayEnd', min: 1, max: 24 },
];
export const kpiDayKeys = ['mondayShort', 'tuesdayShort', 'wednesdayShort', 'thursdayShort', 'fridayShort', 'saturdayShort', 'sundayShort'] satisfies TranslationKey[];

const workFields: KpiNumberField[] = ['responseTargetMinutes', 'responseBaseMinutes', 'reactivationDays', 'offerNextDayHour', 'conversionWindowDays'];
export const kpiPlanFieldGroups = {
  targets: kpiTargetFields.filter((field) => field.name !== 'minimumVolume' && !workFields.includes(field.name)),
  pay: [...kpiPayFields, ...kpiTargetFields.filter((field) => field.name === 'minimumVolume')],
  work: [...kpiScheduleFields, ...kpiTargetFields.filter((field) => workFields.includes(field.name))],
};
export const kpiPlanSectionKeys = { targets: 'kpiPlanTargets', pay: 'kpiPaySettings', work: 'kpiServiceStandards', display: 'kpiDashboardDisplay' } as const satisfies Record<KpiPlanSection, TranslationKey>;
export function kpiSectionForField(name: string): KpiPlanSection {
  if (name === 'enabledMetrics') return 'display';
  if (name === 'workdays' || kpiPlanFieldGroups.work.some((field) => field.name === name)) return 'work';
  if (['tiers', 'baseSalaryMode', 'qualityThresholdInclusive'].includes(name) || kpiPlanFieldGroups.pay.some((field) => field.name === name)) return 'pay';
  return 'targets';
}
export function kpiFieldLabel(field: Field, role: SingleKpiRole): TranslationKey {
  if (field.name === 'minimumVolume') {
    if (role === 'hunter') return 'kpiMinimumBookings';
    return 'kpiMinimumStudents';
  }
  if (field.name === 'volumeTarget') {
    if (role === 'hunter') return 'kpiMonthlyBookings';
    return 'kpiMonthlyStudents';
  }
  if (field.name === 'conversionTargetPercent') {
    if (role === 'hunter') return 'kpiTrialAttendanceTarget';
    return 'kpiTrialPaymentTarget';
  }
  return field.translationKey;
}
