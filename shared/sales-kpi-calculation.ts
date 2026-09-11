import type {
  KpiCalculation, KpiConfig, KpiDetail, KpiFacts, KpiLeadFact, KpiMetric,
  KpiMetricId, KpiPlanConfig, KpiRole, KpiSaleFact, KpiTrialFact, SingleKpiRole,
} from './sales-kpi';
import { isFullCycleKpiConfig, isFullCycleKpiRole } from './sales-kpi';
import { calculateKpiPay } from './sales-kpi-pay';
import { kpiDay, kpiMonthBounds, offerDeadline, workingMinutesBetween } from './sales-kpi-time';

const timestamp = (value: string) => new Date(value).getTime();
const ratio = (numerator: number, denominator: number) => denominator > 0 ? 100 * numerator / denominator : null;
const uniqueBy = <T>(values: T[], key: (value: T) => string | number) => [...new Map(values.map((value) => [key(value), value])).values()];
const personCourse = (trial: KpiTrialFact) => `${trial.studentId}:${trial.courseId}`;
const leadDetail = (lead: KpiLeadFact, date: string | null, success?: boolean, value?: number): KpiDetail => (
  { id: lead.id, entity: 'lead', name: lead.name, date, success, value }
);
const trialDetail = (trial: KpiTrialFact, success?: boolean): KpiDetail => (
  { id: trial.studentId, entity: 'student', name: trial.name, date: trial.scheduledAt, success }
);
const saleDetail = (sale: KpiSaleFact): KpiDetail => (
  { id: sale.id, entity: 'payment', name: sale.name, date: sale.paidAt, value: sale.amountUzs }
);

export function calculateSalesKpi(
  role: KpiRole, employeeId: number, month: string, config: KpiPlanConfig,
  facts: KpiFacts, asOf = new Date().toISOString(),
): KpiCalculation {
  if (isFullCycleKpiRole(role)) {
    if (!isFullCycleKpiConfig(config)) throw new Error('invalid full-cycle KPI config');
    const hunter = calculateSingleSalesKpi('hunter', employeeId, month, config.hunter, facts, asOf);
    const closer = calculateSingleSalesKpi('closer', employeeId, month, config.closer, facts, asOf);
    const combineCondition = (left: boolean | null, right: boolean | null) => (
      left === false || right === false ? false : left === null || right === null ? null : true
    );
    const crm = hunter.metrics.find((metric) => metric.id === 'crm')
      ?? closer.metrics.find((metric) => metric.id === 'crm');
    const metrics = [
      ...hunter.metrics.filter((metric) => metric.id !== 'crm'),
      ...(crm ? [crm] : []),
      ...closer.metrics.filter((metric) => metric.id !== 'crm'),
    ];
    const baseConditions = {
      volume: hunter.baseConditions.volume && closer.baseConditions.volume,
      crm: combineCondition(hunter.baseConditions.crm, closer.baseConditions.crm),
      timing: combineCondition(hunter.baseConditions.timing, closer.baseConditions.timing),
    };
    const conditions = Object.values(baseConditions);
    const baseStatus: KpiCalculation['payLines'][number]['status'] = config.baseSalaryMode === 'guaranteed' || conditions.every((value) => value === true)
      ? 'earned' : conditions.includes(false) ? 'not_met' : 'pending';
    const payLines = [
      {
        key: 'base' as const,
        quantity: 1,
        rateUzs: config.baseSalaryUzs,
        amountUzs: baseStatus === 'earned' ? config.baseSalaryUzs : 0,
        status: baseStatus,
      },
      ...hunter.payLines.filter((line) => line.key !== 'base').map((line) => ({ ...line, phase: 'hunter' as const })),
      ...closer.payLines.filter((line) => line.key !== 'base').map((line) => ({ ...line, phase: 'closer' as const })),
    ];
    return {
      metrics,
      payLines,
      totalUzs: payLines.reduce((sum, line) => sum + line.amountUzs, 0),
      baseConditions,
      reviewableSales: closer.reviewableSales,
      unclassifiedSales: closer.unclassifiedSales,
    };
  }
  if (isFullCycleKpiConfig(config)) throw new Error('invalid single-role KPI config');
  return calculateSingleSalesKpi(role, employeeId, month, config, facts, asOf);
}

function calculateSingleSalesKpi(
  role: SingleKpiRole, employeeId: number, month: string, config: KpiConfig,
  facts: KpiFacts, asOf: string,
): KpiCalculation {
  const { start, end } = kpiMonthBounds(month);
  const now = timestamp(asOf);
  const cutoff = Math.min(end.getTime(), now);
  const inMonth = (value: string | null) => Boolean(value && timestamp(value) >= start.getTime()
    && timestamp(value) < end.getTime() && timestamp(value) <= now);
  const ownedLeads = facts.leads.filter((lead) => (role === 'hunter' ? lead.hunterId : lead.closerId) === employeeId);
  const leadsById = new Map(facts.leads.map((lead) => [lead.id, lead]));
  const isOurs = (trial: KpiTrialFact) => (role === 'hunter' ? trial.hunterId : trial.closerId) === employeeId;
  const validTrials = facts.trials.filter((trial) => trial.status !== 'cancelled'
    && trial.lessonStatus !== 'cancelled' && trial.lessonStatus !== 'not_conducted');
  // Keep the first booking per student/course. A reschedule or a
  // second visit must not create another plan unit or attendance bonus.
  const firstBookings = uniqueBy([...validTrials].sort((a, b) => timestamp(b.bookedAt) - timestamp(a.bookedAt)), personCourse);
  const attended = validTrials.filter((trial) => trial.status === 'attended'
    && ['scheduled', 'completed'].includes(trial.lessonStatus) && timestamp(trial.scheduledAt) <= now);
  const firstAttendance = uniqueBy([...attended].sort((a, b) => timestamp(b.scheduledAt) - timestamp(a.scheduledAt)), personCourse);
  const attendedByCourse = new Map(firstAttendance.map((trial) => [personCourse(trial), trial]));
  const bookings = firstBookings.filter((trial) => isOurs(trial) && inMonth(trial.bookedAt));
  const dueTrials = firstBookings.filter((trial) => isOurs(trial) && inMonth(trial.scheduledAt)
    && timestamp(trial.scheduledAt) + trial.durationMinutes * 60_000 <= cutoff);
  const roleAttendance = role === 'hunter' ? firstAttendance : uniqueBy(
    [...firstAttendance].sort((a, b) => timestamp(b.scheduledAt) - timestamp(a.scheduledAt)), (trial) => trial.studentId);
  const periodAttendance = roleAttendance.filter((trial) => isOurs(trial) && inMonth(trial.scheduledAt));
  const attendedAsBooked = (trial: KpiTrialFact) => attendedByCourse.get(personCourse(trial))?.id === trial.id;
  const cohortAttendance = dueTrials.filter(attendedAsBooked);
  const attendanceRate = ratio(cohortAttendance.length, dueTrials.length);

  const liveSales = facts.sales.filter((sale) => sale.status === 'paid' && sale.amountUzs > 0 && timestamp(sale.paidAt) <= now);
  const newSales = uniqueBy([...liveSales.filter((sale) => sale.kind === 'new')]
    .sort((a, b) => timestamp(b.paidAt) - timestamp(a.paidAt)), (sale) => sale.studentId);
  const periodNew = newSales.filter((sale) => sale.closerId === employeeId && inMonth(sale.paidAt));
  const extraSales = uniqueBy([...liveSales.filter((sale) => ['renewal', 'upsell'].includes(sale.kind) && sale.cycleKey)]
    .sort((a, b) => timestamp(b.paidAt) - timestamp(a.paidAt)),
  (sale) => `${sale.studentId}:${sale.groupId ?? 0}:${sale.cycleKey}`);
  const renewals = extraSales.filter((sale) => sale.kind === 'renewal' && sale.closerId === employeeId && inMonth(sale.paidAt));
  const upsells = extraSales.filter((sale) => sale.kind === 'upsell' && sale.closerId === employeeId && inMonth(sale.paidAt));
  const referrals = periodNew.filter((sale) => sale.referralInitiated);
  const paidByStudent = new Map(newSales.map((sale) => [sale.studentId, sale]));
  // Conversion follows the trial cohort, while the bonus follows the payment
  // month. A late payment can improve its cohort without becoming a second sale.
  const converted = periodAttendance.filter((trial) => {
    const sale = paidByStudent.get(trial.studentId);
    return sale && sale.closerId === employeeId && timestamp(sale.paidAt) >= timestamp(trial.scheduledAt)
      && timestamp(sale.paidAt) <= timestamp(trial.scheduledAt) + config.conversionWindowDays * 86_400_000;
  });
  const conversionRate = ratio(converted.length, periodAttendance.length);
  const received = ownedLeads.filter((lead) => inMonth(lead.receivedAt)
    && timestamp(lead.receivedAt) >= timestamp(lead.trackedAt));
  const crmLeads = role === 'hunter' ? received : uniqueBy(periodAttendance.flatMap((trial) => {
    const lead = trial.leadId ? leadsById.get(trial.leadId) : undefined;
    return lead ? [lead] : [];
  }), (lead) => lead.id);
  const crmComplete = (lead: KpiLeadFact) => Boolean(lead.crmCompletedAt
    && timestamp(lead.crmCompletedAt) <= cutoff
    && (role === 'closer' || kpiDay(lead.crmCompletedAt) === kpiDay(lead.receivedAt)));
  const crmRate = ratio(crmLeads.filter(crmComplete).length, crmLeads.length);
  const replyMinutes = (lead: KpiLeadFact) => workingMinutesBetween(lead.receivedAt,
    lead.firstResponseAt && timestamp(lead.firstResponseAt) <= cutoff ? lead.firstResponseAt : new Date(cutoff).toISOString(), config);
  const replied = (lead: KpiLeadFact, limit: number) => Boolean(lead.firstResponseAt
    && timestamp(lead.firstResponseAt) <= cutoff && replyMinutes(lead) <= limit);
  // Requests whose business-time deadline has not expired are still pending.
  const responseDue = received.filter((lead) => lead.firstResponseAt && timestamp(lead.firstResponseAt) <= cutoff
    || replyMinutes(lead) >= config.responseTargetMinutes);
  const baseResponseDue = received.filter((lead) => lead.firstResponseAt && timestamp(lead.firstResponseAt) <= cutoff
    || replyMinutes(lead) >= config.responseBaseMinutes);
  const responseRate = ratio(responseDue.filter((lead) => replied(lead, config.responseTargetMinutes)).length, responseDue.length);
  const recordedOffer = (trial: KpiTrialFact) => {
    const at = trial.leadId ? leadsById.get(trial.leadId)?.offerAt : null;
    return Boolean(at && timestamp(at) <= cutoff);
  };
  const offerTrials = periodAttendance.filter((trial) => offerDeadline(trial.scheduledAt, config.offerNextDayHour) <= cutoff || recordedOffer(trial));
  const baseOfferTrials = periodAttendance.filter((trial) => offerDeadline(trial.scheduledAt, 0) <= cutoff || recordedOffer(trial));
  const offerOnTime = (trial: KpiTrialFact, base = false) => {
    const at = trial.leadId ? leadsById.get(trial.leadId)?.offerAt : null;
    const deadline = base ? offerDeadline(trial.scheduledAt, 0) : offerDeadline(trial.scheduledAt, config.offerNextDayHour);
    return Boolean(at && timestamp(at) >= timestamp(trial.scheduledAt) && timestamp(at) <= deadline && timestamp(at) <= cutoff);
  };
  const offerRate = ratio(offerTrials.filter((trial) => offerOnTime(trial)).length, offerTrials.length);
  const qualified = ownedLeads.filter((lead) => inMonth(lead.qualifiedAt));
  const coldLeads = ownedLeads.filter((lead) => lead.isCold && timestamp(lead.trackedAt) <= cutoff);
  const recentContact = (lead: KpiLeadFact) => Boolean(lead.lastContactAt
    && timestamp(lead.lastContactAt) <= cutoff && timestamp(lead.lastContactAt) >= cutoff - config.reactivationDays * 86_400_000);
  const reactivatedAttendance = periodAttendance.filter((trial) => trial.reactivated);
  // One renewal opportunity per expiring student/group/period. Second
  // installments share the cycle and cannot inflate either side of the ratio.
  const expiring = uniqueBy(liveSales.filter((sale) => sale.closerId === employeeId && inMonth(sale.paidUntil)
    && sale.paidUntil && timestamp(sale.paidUntil) <= cutoff),
  (sale) => `${sale.studentId}:${sale.groupId ?? 0}:${sale.paidUntil}`);
  const hasRenewed = (old: KpiSaleFact) => extraSales.some((sale) => sale.kind === 'renewal'
    && sale.studentId === old.studentId && sale.groupId === old.groupId && sale.id !== old.id
    && timestamp(sale.paidAt) > timestamp(old.paidAt)
    && timestamp(sale.paidAt) <= timestamp(old.paidUntil!) + config.conversionWindowDays * 86_400_000
    && sale.paidUntil && timestamp(sale.paidUntil) > timestamp(old.paidUntil!));
  const surveys = uniqueBy([...facts.surveys.filter((survey) => survey.closerId === employeeId && inMonth(survey.createdAt))]
    .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt)), (survey) => survey.studentId);
  const nps = surveys.length ? 100 * (surveys.filter((s) => s.score >= 9).length - surveys.filter((s) => s.score <= 6).length) / surveys.length : null;

  const metrics: KpiMetric[] = [];
  const add = (id: KpiMetricId, value: number | null, target: number | null, unit: KpiMetric['unit'],
    details: KpiDetail[], numerator?: number, denominator?: number) => {
    if (config.enabledMetrics.includes(id)) metrics.push({ id, value, target, unit, details, numerator, denominator });
  };
  if (role === 'hunter') {
    add('response', responseRate, 100, 'percent', responseDue.map((lead) => leadDetail(lead, lead.firstResponseAt, replied(lead, config.responseTargetMinutes), replyMinutes(lead))), responseDue.filter((lead) => replied(lead, config.responseTargetMinutes)).length, responseDue.length);
    add('qualified', qualified.length, config.qualifiedTarget || null, 'count', qualified.map((lead) => leadDetail(lead, lead.qualifiedAt)));
    add('bookings', bookings.length, config.volumeTarget, 'count', bookings.map((trial) => trialDetail(trial)));
    add('attendance', attendanceRate, config.conversionTargetPercent, 'percent', dueTrials.map((trial) => trialDetail(trial, attendedAsBooked(trial))), cohortAttendance.length, dueTrials.length);
    add('reactivation', ratio(coldLeads.filter(recentContact).length, coldLeads.length), 100, 'percent', coldLeads.map((lead) => leadDetail(lead, lead.lastContactAt, recentContact(lead))), coldLeads.filter(recentContact).length, coldLeads.length);
    add('reactivatedAttendance', reactivatedAttendance.length, null, 'count', reactivatedAttendance.map((trial) => trialDetail(trial)));
  } else {
    add('newStudents', periodNew.length, config.volumeTarget, 'count', periodNew.map(saleDetail));
    add('trialConversion', conversionRate, config.conversionTargetPercent, 'percent', periodAttendance.map((trial) => trialDetail(trial, converted.includes(trial))), converted.length, periodAttendance.length);
    add('offer', offerRate, 100, 'percent', offerTrials.map((trial) => trialDetail(trial, offerOnTime(trial))), offerTrials.filter((trial) => offerOnTime(trial)).length, offerTrials.length);
    add('renewals', renewals.length, null, 'count', renewals.map(saleDetail));
    add('renewalConversion', ratio(expiring.filter(hasRenewed).length, expiring.length), config.renewalTargetPercent || null, 'percent', expiring.map((sale) => ({ ...saleDetail(sale), success: hasRenewed(sale) })), expiring.filter(hasRenewed).length, expiring.length);
    add('upsells', upsells.length, config.upsellTarget || null, 'count', upsells.map(saleDetail));
    add('referrals', referrals.length, null, 'count', referrals.map(saleDetail));
    add('nps', nps, config.npsTarget, 'score', surveys.map((survey) => ({ id: survey.studentId, entity: 'student', name: survey.name, date: survey.createdAt, value: survey.score })));
  }
  add('crm', crmRate, config.crmTargetPercent, 'percent', crmLeads.map((lead) => leadDetail(lead, lead.crmCompletedAt, crmComplete(lead))), crmLeads.filter(crmComplete).length, crmLeads.length);
  const volume = role === 'hunter' ? bookings.length : periodNew.length;
  const mainConversion = role === 'hunter' ? attendanceRate : conversionRate;
  const baseTiming = role === 'hunter'
    ? (baseResponseDue.length ? baseResponseDue.every((lead) => replied(lead, config.responseBaseMinutes)) : null)
    : (baseOfferTrials.length ? baseOfferTrials.every((trial) => offerOnTime(trial, true)) : null);
  const baseConditions = { volume: volume >= config.minimumVolume,
    crm: crmRate === null ? null : crmRate >= config.crmTargetPercent, timing: baseTiming };
  const payLines = calculateKpiPay(role, config, {
    volume, attendees: periodAttendance.length, conversion: mainConversion,
    reactivated: reactivatedAttendance.length, renewals: renewals.length,
    upsells: upsells.length, referrals: referrals.length, baseConditions,
  });
  return { metrics, payLines, baseConditions, totalUzs: payLines.reduce((sum, line) => sum + line.amountUzs, 0),
    reviewableSales: facts.sales.filter((sale) => sale.closerId === employeeId && sale.status === 'paid' && inMonth(sale.paidAt)),
    unclassifiedSales: facts.sales.filter((sale) => sale.closerId === employeeId && sale.status === 'paid'
      && sale.kind === 'unclassified' && inMonth(sale.paidAt)) };
}
