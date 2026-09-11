import { z } from 'zod';

export const SINGLE_KPI_ROLES = ['hunter', 'closer'] as const;
export type SingleKpiRole = (typeof SINGLE_KPI_ROLES)[number];
export const FULL_CYCLE_KPI_ROLES = ['full_cycle', 'full_cycle_3500'] as const;
export type FullCycleKpiRole = (typeof FULL_CYCLE_KPI_ROLES)[number];
export const KPI_ROLES = [...SINGLE_KPI_ROLES, ...FULL_CYCLE_KPI_ROLES] as const;
export type KpiRole = (typeof KPI_ROLES)[number];
export const isFullCycleKpiRole = (role: string | null | undefined): role is FullCycleKpiRole => (
  FULL_CYCLE_KPI_ROLES.includes(role as FullCycleKpiRole)
);
export const KPI_METRICS = [
  'response', 'qualified', 'bookings', 'attendance', 'crm', 'reactivation',
  'reactivatedAttendance', 'newStudents', 'trialConversion', 'offer',
  'renewals', 'renewalConversion', 'upsells', 'referrals', 'nps',
] as const;
export type KpiMetricId = (typeof KPI_METRICS)[number];
export const ROLE_METRICS: Record<KpiRole, KpiMetricId[]> = {
  hunter: ['response', 'qualified', 'bookings', 'attendance', 'crm', 'reactivation', 'reactivatedAttendance'],
  closer: ['newStudents', 'trialConversion', 'offer', 'crm', 'renewals', 'renewalConversion', 'upsells', 'referrals', 'nps'],
  full_cycle: ['response', 'qualified', 'bookings', 'attendance', 'crm', 'reactivation', 'reactivatedAttendance',
    'newStudents', 'trialConversion', 'offer', 'renewals', 'renewalConversion', 'upsells', 'referrals', 'nps'],
  full_cycle_3500: ['response', 'qualified', 'bookings', 'attendance', 'crm', 'reactivation', 'reactivatedAttendance',
    'newStudents', 'trialConversion', 'offer', 'renewals', 'renewalConversion', 'upsells', 'referrals', 'nps'],
};

const money = z.number().int().min(0).max(1_000_000_000);
const count = z.number().int().min(0).max(100_000);
const percent = z.number().min(0).max(100);
export const kpiMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const kpiRoleSchema = z.enum(KPI_ROLES);

export const kpiConfigSchema = z.object({
  baseSalaryUzs: money,
  baseSalaryMode: z.enum(['guaranteed', 'conditional']),
  variableSalaryUzs: money,
  minimumVolume: count,
  volumeTarget: count.min(1),
  conversionTargetPercent: percent,
  crmTargetPercent: percent,
  qualifiedTarget: count,
  responseTargetMinutes: z.number().int().min(1).max(1_440),
  responseBaseMinutes: z.number().int().min(1).max(1_440),
  offerNextDayHour: z.number().int().min(0).max(23),
  workdayStartHour: z.number().int().min(0).max(23),
  workdayEndHour: z.number().int().min(1).max(24),
  workdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  reactivationDays: z.number().int().min(1).max(365),
  conversionWindowDays: z.number().int().min(1).max(365),
  qualityBonusUzs: money,
  qualityThresholdPercent: percent,
  qualityThresholdInclusive: z.boolean(),
  reactivationBonusUzs: money,
  renewalBonusUzs: money,
  upsellBonusUzs: money,
  referralBonusUzs: money,
  renewalTargetPercent: percent,
  upsellTarget: count,
  npsTarget: z.number().min(-100).max(100),
  tiers: z.array(z.object({ from: count.min(1), rateUzs: money }).strict()).min(1).max(12),
  enabledMetrics: z.array(z.enum(KPI_METRICS)).min(1).max(KPI_METRICS.length),
}).strict().superRefine((value, ctx) => {
  const issue = (path: (string | number)[]) => ctx.addIssue({ code: 'custom', path, message: 'invalidData' });
  if (value.workdayEndHour <= value.workdayStartHour) issue(['workdayEndHour']);
  if (value.responseBaseMinutes < value.responseTargetMinutes) issue(['responseBaseMinutes']);
  if (new Set(value.workdays).size !== value.workdays.length) issue(['workdays']);
  if (new Set(value.enabledMetrics).size !== value.enabledMetrics.length) issue(['enabledMetrics']);
  if (value.tiers[0].from !== 1) issue(['tiers', 0, 'from']);
  value.tiers.forEach((tier, index) => {
    if (index > 0 && tier.from <= value.tiers[index - 1].from) issue(['tiers', index, 'from']);
  });
});
export type KpiConfig = z.infer<typeof kpiConfigSchema>;
export const fullCycleKpiConfigSchema = z.object({
  baseSalaryUzs: money,
  baseSalaryMode: z.enum(['guaranteed', 'conditional']),
  hunter: kpiConfigSchema,
  closer: kpiConfigSchema,
}).strict();
export type FullCycleKpiConfig = z.infer<typeof fullCycleKpiConfigSchema>;
export type KpiPlanConfig = KpiConfig | FullCycleKpiConfig;

export const isFullCycleKpiConfig = (config: KpiPlanConfig): config is FullCycleKpiConfig => (
  'hunter' in config && 'closer' in config
);

const legacyFullCycleKpiConfigSchema = z.object({
  hunter: kpiConfigSchema,
  closer: kpiConfigSchema,
}).strict();

export const parseKpiPlanConfig = (role: KpiRole, config: unknown): KpiPlanConfig => {
  if (!isFullCycleKpiRole(role)) return kpiConfigSchema.parse(config);
  const current = fullCycleKpiConfigSchema.safeParse(config);
  if (current.success) return current.data;
  const legacy = legacyFullCycleKpiConfigSchema.parse(config);
  return {
    baseSalaryUzs: legacy.hunter.baseSalaryUzs + legacy.closer.baseSalaryUzs,
    baseSalaryMode: legacy.hunter.baseSalaryMode === 'guaranteed' && legacy.closer.baseSalaryMode === 'guaranteed'
      ? 'guaranteed' : 'conditional',
    ...legacy,
  };
};

export function defaultKpiConfig(role: SingleKpiRole): KpiConfig {
  const hunter = role === 'hunter';
  return {
    baseSalaryUzs: hunter ? 3_000_000 : 3_500_000,
    // The documents give conditions but no forfeiture policy. Keep the base
    // and show failures until an administrator explicitly changes this rule.
    baseSalaryMode: 'guaranteed',
    variableSalaryUzs: hunter ? 700_000 : 500_000,
    minimumVolume: hunter ? 30 : 15,
    volumeTarget: hunter ? 30 : 21,
    conversionTargetPercent: hunter ? 60 : 50,
    crmTargetPercent: 100,
    qualifiedTarget: 0,
    responseTargetMinutes: 5,
    responseBaseMinutes: 15,
    offerNextDayHour: 11,
    workdayStartHour: 9,
    workdayEndHour: 20,
    workdays: [1, 2, 3, 4, 5, 6],
    reactivationDays: 14,
    conversionWindowDays: 30,
    qualityBonusUzs: hunter ? 200_000 : 0,
    qualityThresholdPercent: 70,
    qualityThresholdInclusive: false,
    reactivationBonusUzs: hunter ? 100_000 : 0,
    renewalBonusUzs: hunter ? 0 : 100_000,
    upsellBonusUzs: hunter ? 0 : 75_000,
    referralBonusUzs: hunter ? 0 : 125_000,
    renewalTargetPercent: 0,
    upsellTarget: 0,
    npsTarget: 50,
    tiers: hunter
      ? [{ from: 1, rateUzs: 70_000 }, { from: 31, rateUzs: 100_000 }]
      : [{ from: 1, rateUzs: 150_000 }, { from: 22, rateUzs: 200_000 }, { from: 28, rateUzs: 250_000 }, { from: 34, rateUzs: 300_000 }],
    enabledMetrics: [...ROLE_METRICS[role]],
  };
}

export function defaultKpiPlanConfig(role: KpiRole): KpiPlanConfig {
  return isFullCycleKpiRole(role)
    ? {
      baseSalaryUzs: role === 'full_cycle' ? 3_000_000 : 3_500_000,
      baseSalaryMode: 'guaranteed',
      hunter: defaultKpiConfig('hunter'),
      closer: defaultKpiConfig('closer'),
    }
    : defaultKpiConfig(role);
}

export type KpiPlanVersion = {
  id: number; role: KpiRole; effectiveMonth: string; config: KpiPlanConfig;
  createdAt: string; createdBy: number | null;
};
export type KpiAssignment = { role: KpiRole | null; effectiveMonth: string; createdAt: string };
export type KpiEmployeeAssignment = {
  userId: number; current: KpiAssignment | null; scheduled: KpiAssignment | null;
};

export type KpiLeadFact = {
  id: number; name: string; hunterId: number | null; closerId: number | null;
  receivedAt: string; trackedAt: string; firstResponseAt: string | null;
  qualifiedAt: string | null; crmCompletedAt: string | null;
  offerAt: string | null; reactivatedAt: string | null;
  isCold: boolean; lastContactAt: string | null;
};
export type KpiTrialFact = {
  id: number; leadId: number | null; studentId: number; courseId: number;
  name: string; hunterId: number | null; closerId: number | null;
  bookedAt: string; scheduledAt: string; durationMinutes: number;
  status: string; lessonStatus: string; reactivated: boolean;
};
export const KPI_SALE_KINDS = ['new', 'renewal', 'upsell', 'installment', 'unclassified'] as const;
export type KpiSaleKind = (typeof KPI_SALE_KINDS)[number];
export type KpiSaleFact = {
  id: number; leadId: number | null; studentId: number; groupId: number | null;
  name: string; closerId: number | null; paidAt: string;
  paidUntil: string | null; amountUzs: number; status: string;
  kind: KpiSaleKind; cycleKey: string | null; referralInitiated: boolean;
};
export type KpiSurveyFact = {
  id: number; studentId: number; name: string; closerId: number | null;
  score: number; createdAt: string;
};
export type KpiFacts = {
  leads: KpiLeadFact[]; trials: KpiTrialFact[]; sales: KpiSaleFact[]; surveys: KpiSurveyFact[];
};
export type KpiDetail = {
  id: number; entity: 'lead' | 'student' | 'payment'; name: string;
  date: string | null; value?: number | null; success?: boolean | null;
};
export type KpiMetric = {
  id: KpiMetricId; value: number | null; target: number | null;
  unit: 'count' | 'percent' | 'score'; numerator?: number; denominator?: number;
  details: KpiDetail[];
};
export type KpiPayLine = {
  key: 'base' | 'variable' | 'tier' | 'quality' | 'reactivation' | 'renewal' | 'upsell' | 'referral';
  quantity: number; rateUzs: number; amountUzs: number;
  status: 'earned' | 'not_met' | 'pending'; from?: number; to?: number; phase?: SingleKpiRole;
};
export type KpiCalculation = {
  metrics: KpiMetric[]; payLines: KpiPayLine[]; totalUzs: number;
  baseConditions: { volume: boolean; crm: boolean | null; timing: boolean | null };
  unclassifiedSales: KpiSaleFact[];
  reviewableSales: KpiSaleFact[];
};
export type KpiOverviewEmployee = {
  id: number; name: string; role: KpiRole; assignedAt: string;
  version: KpiPlanVersion; calculation: KpiCalculation;
};
export type KpiOverview = { month: string; asOf: string; employees: KpiOverviewEmployee[] };

export type KpiPlanSettings = {
  versions: KpiPlanVersion[]; currentMonth: string;
  minimumEffectiveMonth: Record<KpiRole, string>;
};
export type KpiLeadOwnership = {
  hunter: { id: number; name: string } | null;
  closer: { id: number; name: string } | null;
  inCloserQueue: boolean;
  canClaim: boolean;
  canRecordOffer: boolean;
  offerAt: string | null;
};
export const kpiSaleReviewSchema = z.object({
  kind: z.enum(['new', 'renewal', 'upsell', 'installment']),
  cycleKey: z.string().trim().max(120).nullable(),
  referralInitiated: z.boolean(),
  reason: z.string().trim().min(3).max(500),
}).strict().superRefine((value, ctx) => {
  if (['renewal', 'upsell'].includes(value.kind) && !value.cycleKey) {
    ctx.addIssue({ code: 'custom', path: ['cycleKey'], message: 'kpiCycleRequired' });
  }
  if (value.referralInitiated && value.kind !== 'new') {
    ctx.addIssue({ code: 'custom', path: ['referralInitiated'], message: 'invalidData' });
  }
});
export type KpiSaleReview = z.infer<typeof kpiSaleReviewSchema>;
