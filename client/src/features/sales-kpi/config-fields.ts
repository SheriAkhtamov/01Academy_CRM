import type { KpiConfig, KpiRole } from '@shared/sales-kpi';
import type { TranslationKey } from '@/lib/i18n';

export type KpiNumberField = { [K in keyof KpiConfig]: KpiConfig[K] extends number ? K : never }[keyof KpiConfig];
type Field = { name: KpiNumberField; translationKey: TranslationKey; min?: number; max?: number; role?: KpiRole };
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
