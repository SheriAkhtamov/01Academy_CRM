import type { KpiCalculation, KpiConfig, KpiPayLine, SingleKpiRole } from './sales-kpi';

/** Each person is paid at exactly one marginal tier. */
export function calculateKpiTiers(quantity: number, tiers: KpiConfig['tiers']): KpiPayLine[] {
  return tiers.map((tier, index) => {
    const to = tiers[index + 1] ? tiers[index + 1].from - 1 : undefined;
    const count = Math.max(0, Math.min(quantity, to ?? quantity) - tier.from + 1);
    return { key: 'tier', from: tier.from, to, quantity: count, rateUzs: tier.rateUzs,
      amountUzs: count * tier.rateUzs, status: count > 0 ? 'earned' : 'not_met' };
  });
}

export type KpiPayInput = {
  volume: number; attendees: number; conversion: number | null;
  reactivated: number; renewals: number; upsells: number; referrals: number;
  baseConditions: KpiCalculation['baseConditions'];
};

/** Calculates salary and bonuses for the server KPI report. */
export function calculateKpiPay(role: SingleKpiRole, config: KpiConfig, input: KpiPayInput): KpiPayLine[] {
  const conditions = Object.values(input.baseConditions);
  const baseStatus = config.baseSalaryMode === 'guaranteed' || conditions.every((value) => value === true)
    ? 'earned' : conditions.includes(false) ? 'not_met' : 'pending';
  const payLines: KpiPayLine[] = [];
  const pay = (key: KpiPayLine['key'], quantity: number, rateUzs: number, status: KpiPayLine['status'] = 'earned') => {
    payLines.push({ key, quantity, rateUzs, amountUzs: status === 'earned' ? quantity * rateUzs : 0, status });
  };
  pay('base', 1, config.baseSalaryUzs, baseStatus);
  pay('variable', 1, config.variableSalaryUzs, input.volume < config.volumeTarget ? 'not_met'
    : input.conversion === null ? 'pending' : input.conversion >= config.conversionTargetPercent ? 'earned' : 'not_met');
  payLines.push(...calculateKpiTiers(role === 'hunter' ? input.attendees : input.volume, config.tiers));
  if (role === 'hunter') {
    const quality = input.conversion === null ? 'pending' : (config.qualityThresholdInclusive
      ? input.conversion >= config.qualityThresholdPercent : input.conversion > config.qualityThresholdPercent) ? 'earned' : 'not_met';
    pay('quality', 1, config.qualityBonusUzs, quality);
    pay('reactivation', input.reactivated, config.reactivationBonusUzs);
  } else {
    pay('renewal', input.renewals, config.renewalBonusUzs);
    pay('upsell', input.upsells, config.upsellBonusUzs);
    pay('referral', input.referrals, config.referralBonusUzs);
  }
  return payLines;
}
