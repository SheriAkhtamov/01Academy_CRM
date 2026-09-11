import { describe, expect, it } from 'vitest';
import { defaultKpiConfig, defaultKpiPlanConfig, fullCycleKpiConfigSchema, kpiConfigSchema, type KpiFacts, type KpiLeadFact, type KpiSaleFact, type KpiTrialFact } from '../shared/sales-kpi';
import { calculateSalesKpi } from '../shared/sales-kpi-calculation';
import { calculateKpiPay, calculateKpiTiers, type KpiPayInput } from '../shared/sales-kpi-pay';
import { kpiMonth, kpiMonthBounds, nextKpiMonth, offerDeadline, workingMinutesBetween } from '../shared/sales-kpi-time';

const at = (day: number, time = '10:00') => `2026-09-${String(day).padStart(2, '0')}T${time}:00+05:00`;
const trial = (id: number, overrides: Partial<KpiTrialFact> = {}): KpiTrialFact => ({
  id, studentId: id, leadId: id, courseId: 1, name: `Student ${id}`, hunterId: 7, closerId: 8,
  bookedAt: at(1), scheduledAt: at(3), durationMinutes: 60,
  status: 'attended', lessonStatus: 'completed', reactivated: false, ...overrides,
});
const sale = (id: number, overrides: Partial<KpiSaleFact> = {}): KpiSaleFact => ({
  id, studentId: id, leadId: id, groupId: 1, name: `Student ${id}`, closerId: 8,
  paidAt: at(4), paidUntil: null, amountUzs: 250_000, status: 'paid',
  kind: 'new', cycleKey: null, referralInitiated: false, ...overrides,
});
const lead = (id: number, overrides: Partial<KpiLeadFact> = {}): KpiLeadFact => ({
  id, name: `Lead ${id}`, hunterId: 7, closerId: 8, receivedAt: at(7), trackedAt: at(1),
  firstResponseAt: null, qualifiedAt: null, crmCompletedAt: null, offerAt: null,
  reactivatedAt: null, isCold: false, lastContactAt: null, ...overrides,
});
const facts = (overrides: Partial<KpiFacts> = {}): KpiFacts => ({ leads: [], trials: [], sales: [], surveys: [], ...overrides });
const payInput = (overrides: Partial<KpiPayInput> = {}): KpiPayInput => ({
  volume: 30, attendees: 30, conversion: 75, reactivated: 0, renewals: 0, upsells: 0, referrals: 0,
  baseConditions: { volume: true, crm: true, timing: true }, ...overrides,
});
const sum = (lines: { amountUzs: number }[]) => lines.reduce((total, line) => total + line.amountUzs, 0);
const calc = (data: KpiFacts, role: 'hunter' | 'closer' = 'hunter', asOf = at(30, '23:59'), month = '2026-09') =>
  calculateSalesKpi(role, role === 'hunter' ? 7 : 8, month, defaultKpiConfig(role), data, asOf);
const metric = (result: ReturnType<typeof calc>, id: string) => result.metrics.find((m) => m.id === id)!;

describe('sales KPI pay rules', () => {
  it.each([[30, 2_100_000], [31, 2_200_000], [41, 3_200_000]])('pays hunter attendance %i using the new 31st-person boundary', (count, total) => {
    expect(sum(calculateKpiTiers(count, defaultKpiConfig('hunter').tiers))).toBe(total);
  });
  it.each([[21, 3_150_000], [22, 3_350_000], [27, 4_350_000], [28, 4_600_000], [33, 5_850_000], [34, 6_150_000]])('pays closer %i students at marginal tiers', (count, total) => {
    expect(sum(calculateKpiTiers(count, defaultKpiConfig('closer').tiers))).toBe(total);
  });
  it('requires both volume and conversion for variable pay and strictly more than 70% for quality', () => {
    const get = (input: Partial<KpiPayInput>) => calculateKpiPay('hunter', defaultKpiConfig('hunter'), payInput(input));
    expect(get({ volume: 29 }).find((p) => p.key === 'variable')?.amountUzs).toBe(0);
    expect(get({ conversion: 59.99 }).find((p) => p.key === 'variable')?.amountUzs).toBe(0);
    expect(get({ conversion: 60 }).find((p) => p.key === 'variable')?.amountUzs).toBe(700_000);
    expect(get({ conversion: 70 }).find((p) => p.key === 'quality')?.amountUzs).toBe(0);
    expect(get({ conversion: 70.01 }).find((p) => p.key === 'quality')?.amountUzs).toBe(200_000);
    expect(get({ conversion: null }).find((p) => p.key === 'variable')?.status).toBe('pending');
  });
  it('adds reactivation to attendance and sums all closer bonus types separately', () => {
    expect(sum(calculateKpiPay('hunter', defaultKpiConfig('hunter'), payInput({ attendees: 31, reactivated: 2 })))).toBe(6_300_000);
    expect(sum(calculateKpiPay('closer', defaultKpiConfig('closer'), payInput({ volume: 28, renewals: 4, upsells: 3, referrals: 2 })))).toBe(9_475_000);
  });
  it('shows missing base conditions without withholding the guaranteed base', () => {
    const config = defaultKpiConfig('hunter');
    const input = payInput({ baseConditions: { volume: true, crm: null, timing: null } });
    expect(calculateKpiPay('hunter', config, input)[0].amountUzs).toBe(3_000_000);
    expect(calculateKpiPay('hunter', { ...config, baseSalaryMode: 'conditional' }, input)[0].status).toBe('pending');
  });
  it('rejects ambiguous tier ordering, duplicate weekdays and invalid working hours', () => {
    const config = defaultKpiConfig('hunter');
    for (const changes of [{ tiers: [{ from: 2, rateUzs: 1 }] }, { workdays: [1, 1] }, { workdayEndHour: 8 },
      { tiers: [{ from: 1, rateUzs: 1 }, { from: 1, rateUzs: 2 }] }]) {
      expect(kpiConfigSchema.safeParse({ ...config, ...changes }).success).toBe(false);
    }
  });
});

describe('sales KPI attribution and month accounting', () => {
  it('combines hunter and closer results for one full-cycle owner without duplicate metrics', () => {
    const data = facts({
      leads: [lead(1, { closerId: 7, firstResponseAt: at(7, '10:03'), crmCompletedAt: at(7, '10:04') })],
      trials: [trial(1, { closerId: 7 })],
      sales: [sale(1, { closerId: 7 })],
    });
    const config = fullCycleKpiConfigSchema.parse(defaultKpiPlanConfig('full_cycle'));
    const result = calculateSalesKpi('full_cycle', 7, '2026-09', config, data, at(30, '23:59'));
    const hunterResult = calculateSalesKpi('hunter', 7, '2026-09', config.hunter, data, at(30, '23:59'));
    const closerResult = calculateSalesKpi('closer', 7, '2026-09', config.closer, data, at(30, '23:59'));
    expect(result.metrics.find((item) => item.id === 'bookings')?.value).toBe(1);
    expect(result.metrics.find((item) => item.id === 'newStudents')?.value).toBe(1);
    expect(result.metrics.filter((item) => item.id === 'crm')).toHaveLength(1);
    expect(new Set(result.metrics.map((item) => item.id)).size).toBe(result.metrics.length);
    expect(new Set(result.payLines.map((line) => line.phase))).toEqual(new Set(['hunter', 'closer']));
    expect(result.totalUzs).toBe(hunterResult.totalUzs + closerResult.totalUzs);
  });

  it('counts one booking and attendance per student/course, preserving the original owner', () => {
    const data = facts({ trials: [trial(1), trial(2, { studentId: 1, hunterId: 9, bookedAt: at(4), scheduledAt: at(5), reactivated: true })] });
    const result = calc(data);
    expect(metric(result, 'bookings').value).toBe(1);
    expect(metric(result, 'attendance')).toMatchObject({ value: 100, denominator: 1, numerator: 1 });
    expect(result.payLines.find((p) => p.key === 'tier')?.amountUzs).toBe(70_000);
    const other = calculateSalesKpi('hunter', 9, '2026-09', defaultKpiConfig('hunter'), data, at(30));
    expect(metric(other, 'bookings').value).toBe(0);
    expect(other.payLines.find((p) => p.key === 'tier')?.amountUzs).toBe(0);
  });
  it('counts explicit attendance before lesson completion, but not cancellations or future lessons', () => {
    const result = calc(facts({ trials: [trial(1, { status: 'cancelled' }), trial(2, { studentId: 1 }),
      trial(3, { lessonStatus: 'scheduled' }), trial(4, { scheduledAt: '2026-10-03T10:00:00+05:00' })] }));
    expect(result.payLines.find((p) => p.key === 'tier')?.quantity).toBe(2);
    expect(metric(result, 'attendance')).toMatchObject({ numerator: 2, denominator: 2 });
  });
  it('includes a prior-month booking in attendance without another booking unit', () => {
    const result = calc(facts({ trials: [trial(1, { bookedAt: '2026-08-31T10:00:00+05:00' })] }));
    expect(metric(result, 'bookings').value).toBe(0);
    expect(result.payLines.find((p) => p.key === 'tier')?.quantity).toBe(1);
  });
  it('does not turn a no-show into a successful prior-month attendance after a repeat lesson', () => {
    const result = calc(facts({ trials: [trial(1, { status: 'no_show' }),
      trial(2, { studentId: 1, bookedAt: '2026-10-01T10:00:00+05:00', scheduledAt: '2026-10-02T10:00:00+05:00' })] }),
    'hunter', '2026-10-05T10:00:00+05:00');
    expect(metric(result, 'attendance').value).toBe(0);
  });
  it('uses first actual installment for a new student and excludes pending, refunded and zero payments', () => {
    const result = calc(facts({ sales: [sale(1, { amountUzs: 100_000 }), sale(2, { studentId: 1, kind: 'installment' }),
      sale(3, { status: 'refunded', referralInitiated: true }), sale(4, { status: 'pending' }), sale(5, { amountUzs: 0 })] }), 'closer');
    expect(metric(result, 'newStudents').value).toBe(1);
    expect(metric(result, 'referrals').value).toBe(0);
    expect(result.payLines.find((p) => p.key === 'tier')?.amountUzs).toBe(150_000);
  });
  it('counts one closer conversion per new student even if they tried two courses', () => {
    const result = calc(facts({ trials: [trial(1), trial(2, { studentId: 1, courseId: 2 })], sales: [sale(1)] }), 'closer');
    expect(metric(result, 'trialConversion')).toMatchObject({ value: 100, denominator: 1, numerator: 1 });
  });
  it('follows the trial cohort across months but pays a new-sale bonus only in the payment month', () => {
    const data = facts({ trials: [trial(1, { scheduledAt: at(29) })], sales: [sale(1, { paidAt: '2026-10-02T10:00:00+05:00' })] });
    const before = calc(data, 'closer');
    expect(metric(before, 'trialConversion').value).toBe(0);
    const after = calc(data, 'closer', '2026-10-04T10:00:00+05:00');
    expect(metric(after, 'trialConversion').value).toBe(100);
    expect(metric(after, 'newStudents').value).toBe(0);
    const october = calc(data, 'closer', '2026-10-04T10:00:00+05:00', '2026-10');
    expect(metric(october, 'newStudents').value).toBe(1);
  });
  it('does not count payments before the trial or beyond the conversion window', () => {
    const result = calc(facts({ trials: [trial(1), trial(2)], sales: [sale(1, { paidAt: at(2) }),
      sale(2, { paidAt: '2026-10-05T10:00:00+05:00' })] }), 'closer', '2026-10-06T10:00:00+05:00');
    expect(metric(result, 'trialConversion').value).toBe(0);
  });
  it('deduplicates renewal/upsell cycles and pays the referral bonus in addition to the new sale', () => {
    const result = calc(facts({ sales: [sale(1, { referralInitiated: true }),
      sale(2, { kind: 'renewal', cycleKey: '2026-10' }), sale(3, { studentId: 2, kind: 'upsell', cycleKey: '2026-10', paidAt: at(5) }),
      sale(4, { kind: 'upsell', cycleKey: '2026-10' }), sale(5, { kind: 'unclassified' })] }), 'closer');
    expect(metric(result, 'renewals').value).toBe(1);
    expect(metric(result, 'upsells').value).toBe(1);
    expect(metric(result, 'referrals').value).toBe(1);
    expect(result.unclassifiedSales.map((s) => s.id)).toEqual([5]);
  });
  it('counts renewal opportunities once across split payments', () => {
    const result = calc(facts({ sales: [sale(1, { paidAt: '2026-08-01T10:00:00+05:00', paidUntil: at(10) }),
      sale(2, { studentId: 1, kind: 'installment', paidAt: '2026-08-15T10:00:00+05:00', paidUntil: at(10) }),
      sale(3, { studentId: 1, kind: 'renewal', cycleKey: '2026-10', paidAt: at(9), paidUntil: '2026-10-10T10:00:00+05:00' })] }), 'closer');
    expect(metric(result, 'renewalConversion')).toMatchObject({ value: 100, denominator: 1, numerator: 1 });
  });
  it('uses the latest NPS response per student and never leaks another closer’s scores', () => {
    const response = (id: number, studentId: number, score: number, day: number, closerId = 8) => ({ id, studentId, name: 'Student', score, createdAt: at(day), closerId });
    const result = calc(facts({ surveys: [response(1, 1, 2, 1), response(2, 1, 10, 3), response(3, 2, 8, 4), response(4, 3, 0, 3, 99)] }), 'closer');
    expect(metric(result, 'nps').value).toBe(50);
    expect(metric(result, 'nps').details).toHaveLength(2);
  });
});

describe('sales KPI business time', () => {
  it('uses the Tashkent month boundary, including December rollover', () => {
    expect(kpiMonth('2026-08-31T19:00:00Z')).toBe('2026-09');
    expect(kpiMonthBounds('2026-09').start.toISOString()).toBe('2026-08-31T19:00:00.000Z');
    expect(nextKpiMonth('2026-12')).toBe('2027-01');
    expect(new Date(offerDeadline(at(30, '23:00'), 11)).toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });
  it('pauses the response clock overnight and on Sunday', () => {
    expect(workingMinutesBetween(at(5, '19:58'), at(7, '09:03'), defaultKpiConfig('hunter'))).toBe(5);
    const result = calc(facts({ leads: [lead(1, { receivedAt: at(5, '19:58'), firstResponseAt: at(7, '09:03') })] }));
    expect(metric(result, 'response').value).toBe(100);
  });
  it('keeps an unexpired response pending and excludes leads from before assignment', () => {
    const data = facts({ leads: [lead(1), lead(2, { trackedAt: at(8), receivedAt: at(7) })] });
    expect(metric(calc(data, 'hunter', at(7, '10:04')), 'response').value).toBeNull();
    expect(metric(calc(data, 'hunter', at(7, '10:05')), 'response')).toMatchObject({ value: 0, denominator: 1 });
  });
  it('checks CRM completion on the lead day and keeps later updates from changing closed periods', () => {
    const data = facts({ leads: [lead(1, { crmCompletedAt: at(7, '18:00') }), lead(2, { crmCompletedAt: at(8) }),
      lead(3, { crmCompletedAt: '2026-10-01T10:00:00+05:00' })] });
    expect(metric(calc(data), 'crm')).toMatchObject({ numerator: 1, denominator: 3 });
  });
  it('separates the same-day base condition from the next-day 11:00 offer target', () => {
    const data = facts({ trials: [trial(1, { scheduledAt: at(7, '18:00') })], leads: [lead(1)] });
    const result = calc(data, 'closer', at(8, '09:00'));
    expect(result.baseConditions.timing).toBe(false);
    expect(metric(result, 'offer').value).toBeNull();
  });
});
