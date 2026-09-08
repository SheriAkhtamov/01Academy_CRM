import type { KpiConfig, KpiMetricId, KpiPayLine, KpiRole, KpiSaleKind } from '@shared/sales-kpi';
import type { TranslationKey } from '@/lib/i18n';

export const roleKeys = { hunter: 'kpiHunter', closer: 'kpiCloser' } satisfies Record<KpiRole, TranslationKey>;
export const metricKeys = {
  response: 'kpiResponseMetric', qualified: 'kpiQualifiedMetric', bookings: 'kpiBookingsMetric',
  attendance: 'kpiAttendanceMetric', crm: 'kpiCrmMetric', reactivation: 'kpiReactivationMetric',
  reactivatedAttendance: 'kpiReactivatedAttendanceMetric', newStudents: 'kpiNewStudentsMetric',
  trialConversion: 'kpiTrialConversionMetric', offer: 'kpiOfferMetric', renewals: 'kpiRenewalsMetric',
  renewalConversion: 'kpiRenewalConversionMetric', upsells: 'kpiUpsellsMetric', referrals: 'kpiReferralsMetric', nps: 'kpiNpsMetric',
} satisfies Record<KpiMetricId, TranslationKey>;
export const metricHelpKeys = {
  response: 'kpiResponseHelp', qualified: 'kpiQualifiedHelp', bookings: 'kpiBookingsHelp',
  attendance: 'kpiAttendanceHelp', crm: 'kpiCrmHelp', reactivation: 'kpiReactivationHelp',
  reactivatedAttendance: 'kpiReactivatedHelp', newStudents: 'kpiNewStudentsHelp',
  trialConversion: 'kpiTrialConversionHelp', offer: 'kpiOfferHelp', renewals: 'kpiRenewalsHelp',
  renewalConversion: 'kpiRenewalConversionHelp', upsells: 'kpiUpsellsHelp', referrals: 'kpiReferralsHelp', nps: 'kpiNpsHelp',
} satisfies Record<KpiMetricId, TranslationKey>;
export function metricHelp(id: KpiMetricId, config: KpiConfig, t: (key: TranslationKey) => string) {
  return t(metricHelpKeys[id]).replace('{minutes}', String(config.responseTargetMinutes))
    .replace('{days}', String(id === 'reactivation' ? config.reactivationDays : config.conversionWindowDays))
    .replace('{hour}', String(config.offerNextDayHour));
}
export const payKeys = {
  base: 'kpiPayBase', variable: 'kpiPayVariable', tier: 'kpiPayTier', quality: 'kpiPayQuality',
  reactivation: 'kpiPayReactivation', renewal: 'kpiPayRenewal', upsell: 'kpiPayUpsell', referral: 'kpiPayReferral',
} satisfies Record<KpiPayLine['key'], TranslationKey>;
export const statusKeys = {
  earned: 'kpiEarned', not_met: 'kpiNotMet', pending: 'kpiPending',
} satisfies Record<KpiPayLine['status'], TranslationKey>;
export const saleKindKeys = {
  new: 'kpiSaleNew', renewal: 'kpiSaleRenewal', upsell: 'kpiSaleUpsell', installment: 'kpiSaleInstallment', unclassified: 'kpiSaleUnclassified',
} satisfies Record<KpiSaleKind, TranslationKey>;
export const kpiMoney = (value: number, language: string) => new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
  style: 'currency', currency: 'UZS', maximumFractionDigits: 0,
}).format(value);
