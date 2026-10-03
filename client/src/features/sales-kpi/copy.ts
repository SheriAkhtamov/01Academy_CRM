import { type KpiMetricId, type KpiRole, type KpiSaleKind } from '@shared/sales-kpi';
import type { TranslationKey } from '@/lib/i18n';

export const roleKeys = {
  hunter: 'kpiHunter',
  closer: 'kpiCloser',
  full_cycle: 'kpiFullCycle3000',
  full_cycle_3500: 'kpiFullCycle3500',
} satisfies Record<KpiRole, TranslationKey>;
export const metricKeys = {
  response: 'kpiResponseMetric', qualified: 'kpiQualifiedMetric', bookings: 'kpiBookingsMetric',
  attendance: 'kpiAttendanceMetric', crm: 'kpiCrmMetric', reactivation: 'kpiReactivationMetric',
  reactivatedAttendance: 'kpiReactivatedAttendanceMetric', newStudents: 'kpiNewStudentsMetric',
  trialConversion: 'kpiTrialConversionMetric', offer: 'kpiOfferMetric', renewals: 'kpiRenewalsMetric',
  renewalConversion: 'kpiRenewalConversionMetric', upsells: 'kpiUpsellsMetric', referrals: 'kpiReferralsMetric', nps: 'kpiNpsMetric',
} satisfies Record<KpiMetricId, TranslationKey>;
export const saleKindKeys = {
  new: 'kpiSaleNew', renewal: 'kpiSaleRenewal', upsell: 'kpiSaleUpsell', installment: 'kpiSaleInstallment', unclassified: 'kpiSaleUnclassified',
} satisfies Record<KpiSaleKind, TranslationKey>;
export const kpiMoney = (value: number, language: string) => new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
  style: 'currency', currency: 'UZS', maximumFractionDigits: 0,
}).format(value);
