import { Router } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { pool } from '../../db';
import { appConfig } from '../../config';
import { requireAuth } from '../../middleware/auth.middleware';
import { storage } from '../../storage';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import { isGeneratedInstagramLeadName } from '../../lib/instagram-lead';
import {
  getZonedDateTimeParts,
  getZonedDateOnlyRange,
  getZonedDayRange,
  getZonedMonthRange,
  zonedWallClockToInstant,
} from '../../lib/academy-time';
import {
  buildRecurringLessonSchedule,
  type CalendarDate,
} from '../../lib/lesson-schedule';
import { runAutomations } from '../../services/automations';
import { onlinePbxClient, OnlinePbxError } from '../../services/onlinepbx';
import { syncLeadSourceChannel } from '../../services/lead-channels';
import { getWorkforcePolicy, maskPhone } from '../../services/workforce-policy';
import {
  CHURN_REASONS,
  FINAL_PROJECT_STATUSES,
  GROUP_STATUSES,
  LEAD_ARCHIVE_REASON_CODES,
  LEAD_STATUSES,
  LESSON_STATUSES,
  PAYMENT_DISCOUNTS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  REFERRAL_BENEFIT_TYPES,
  REFERRAL_TIERS,
  STUDENT_STATUSES,
  TARGET_ATTENDANCE_PERCENT,
  TARGET_CAC_UZS,
  TARGET_LTV_CAC_RATIO,
  TARGET_NPS,
  TARGET_ROAS,
  addDays,
  addMinutes,
  buildReferralCode,
  calculateAttendancePercent,
  calculateAverage,
  calculateAvgDealCycleDays,
  calculateAvgStudyMonths,
  calculateCac,
  calculateLtv,
  calculateNps,
  calculateProgressPercent,
  calculateRoas,
  calculateTrend,
  canAccessAcademyModule,
  getAssignedModules,
  getComputedPaymentStatus,
  hasLeadershipAccess,
  normalizeMoney,
  resolveStudentRiskFlags,
  resolveReferralLevel,
  resolveReferralMilestone,
  suggestCourseSlugByAge,
  validateLeadForStatusChange,
  validateLeadStatusTransition } from '@shared/academy';
import {
  getGroupScheduleValidationError,
  getMinimumGroupEndDate,
  normalizeWeeklySchedule,
  parseScheduleTimeToMinutes,
  scheduleIntervalsOverlap,
  weeklySchedulesOverlap,
  type NormalizedWeeklyScheduleItem,
} from '@shared/scheduling';
import {
  leadTagNameKey,
  normalizeLeadTagName,
  type LeadTagOption,
} from '@shared/lead-tags';

import {
  ACADEMY_TIME_ZONE,
  DatasetActor,
  Row,
  applyLeadVisibilityForActor,
  getCompanySettings,
  leadPhoneNumbersSelect,
  leadTagsSelect,
  query,
  queryOne,
  studentGroupMembershipsSelect,
  toAnalyticsTargets,
} from './academy-core';
import {
  ReportingRange,
  academyDateOnlyKey,
  reportingBuckets,
} from './academy-scheduling';

export const resolveTeacherId = async (userId: number): Promise<number | null> => {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM academy_teachers WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  return row ? Number(row.id) : null;
};

export const getAcademyDataset = async (actor?: DatasetActor) => {
  // Module scoping: teachers see only their own groups; sales employees see only
  // their own leads/students; marketing receives its module dataset.
  const actorModules = getAssignedModules(actor);
  // Entering the teacher module is an explicit context switch. It must
  // always resolve to the actor's teacher profile, even when that user also
  // has administration/leadership permissions.
  const shouldScopeToTeacher = actor?.scopeModule === 'teacher';
  const teacherId = shouldScopeToTeacher
    ? await resolveTeacherId(actor.userId)
    : null;
  // A missing teacher profile must fail closed. Treating a null mapping as an
  // unscoped dataset would expose every teacher's groups and students.
  const isTeacherScoped = shouldScopeToTeacher;
  const isManagerScoped =
    actor?.scopeModule === 'sales' &&
    actorModules.includes('sales') &&
    !hasLeadershipAccess(actor);

  const managerParams = isManagerScoped ? [actor!.userId] : [];

  const [
    schools,
    rooms,
    courses,
    sources,
    statuses,
    teachers,
    groups,
    leads,
    archivedLeads,
    students,
    lessons,
    attendance,
    payments,
    tasks,
    lessonSurveys,
    parentSurveys,
    expenses,
    projects,
    referrals,
    referralBenefits,
  ] = await Promise.all([
    query(`SELECT * FROM academy_schools ORDER BY is_active DESC, name`),
    query(`SELECT * FROM academy_rooms ORDER BY school_id, is_active DESC, name`),
    query(`SELECT * FROM academy_courses ORDER BY name`),
    query(`SELECT * FROM academy_lead_sources WHERE is_active = true ORDER BY name`),
    query(`SELECT * FROM academy_lead_statuses ORDER BY sort_order`),
    isTeacherScoped
      ? query(`SELECT * FROM academy_teachers WHERE id = $1 ORDER BY full_name`, [teacherId])
      : query(`SELECT * FROM academy_teachers ORDER BY full_name`),
    isTeacherScoped
      ? query(`SELECT g.*, c.name AS course_name, t.full_name AS teacher_name,
          sc.name AS school_name, r.name AS room_name,
          (SELECT COUNT(*)::int
           FROM academy_student_group_enrollments enrollment
           JOIN academy_students s ON s.id = enrollment.student_id
           WHERE enrollment.group_id = g.id
             AND enrollment.status = 'active'
             AND s.status = 'studying') AS current_students,
          (SELECT COUNT(DISTINCT l.id)::int
           FROM academy_lead_group_reservations reservation
           JOIN academy_leads l ON l.id = reservation.lead_id
           WHERE reservation.group_id = g.id
             AND l.status_code <> 'not_now'
             AND COALESCE(l.is_archived, false) = false
             AND NOT EXISTS (SELECT 1 FROM academy_students st WHERE st.lead_id = l.id)) AS reserved_students
          FROM academy_groups g
          LEFT JOIN academy_courses c ON c.id = g.course_id
          LEFT JOIN academy_teachers t ON t.id = g.teacher_id
          LEFT JOIN academy_schools sc ON sc.id = g.school_id
          LEFT JOIN academy_rooms r ON r.id = g.room_id
          WHERE g.teacher_id = $1
          ORDER BY g.created_at DESC`, [teacherId])
      : query(`SELECT g.*, c.name AS course_name, t.full_name AS teacher_name,
          sc.name AS school_name, r.name AS room_name,
          (SELECT COUNT(*)::int
           FROM academy_student_group_enrollments enrollment
           JOIN academy_students s ON s.id = enrollment.student_id
           WHERE enrollment.group_id = g.id
             AND enrollment.status = 'active'
             AND s.status = 'studying') AS current_students,
          (SELECT COUNT(DISTINCT l.id)::int
           FROM academy_lead_group_reservations reservation
           JOIN academy_leads l ON l.id = reservation.lead_id
           WHERE reservation.group_id = g.id
             AND l.status_code <> 'not_now'
             AND COALESCE(l.is_archived, false) = false
             AND NOT EXISTS (SELECT 1 FROM academy_students st WHERE st.lead_id = l.id)) AS reserved_students
          FROM academy_groups g
          LEFT JOIN academy_courses c ON c.id = g.course_id
          LEFT JOIN academy_teachers t ON t.id = g.teacher_id
          LEFT JOIN academy_schools sc ON sc.id = g.school_id
          LEFT JOIN academy_rooms r ON r.id = g.room_id
          ORDER BY g.created_at DESC`),
    query(`SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, u.full_name AS manager_name,
        sc.name AS school_name, archived_by_user.full_name AS archived_by_name,
        ${leadPhoneNumbersSelect('l')},
        ${leadTagsSelect('l')}
      FROM academy_leads l
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_lead_sources s ON s.id = l.source_id AND s.is_active = true
      LEFT JOIN users u ON u.id = l.manager_id
      LEFT JOIN academy_schools sc ON sc.id = l.school_id
      LEFT JOIN users archived_by_user ON archived_by_user.id = l.archived_by
      WHERE COALESCE(l.is_archived, false) = false ${isManagerScoped ? 'AND (l.manager_id = $1 OR l.manager_id IS NULL)' : ''} ${isTeacherScoped ? 'AND FALSE' : ''}
      ORDER BY l.created_at DESC`, managerParams),
    isTeacherScoped
      ? Promise.resolve([])
      : query(`SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, u.full_name AS manager_name,
          sc.name AS school_name, archived_by_user.full_name AS archived_by_name,
          ${leadPhoneNumbersSelect('l')},
          ${leadTagsSelect('l')}
        FROM academy_leads l
        LEFT JOIN academy_courses c ON c.id = l.course_id
        LEFT JOIN academy_lead_sources s ON s.id = l.source_id AND s.is_active = true
        LEFT JOIN users u ON u.id = l.manager_id
        LEFT JOIN academy_schools sc ON sc.id = l.school_id
        LEFT JOIN users archived_by_user ON archived_by_user.id = l.archived_by
        WHERE COALESCE(l.is_archived, false) = true ${isManagerScoped ? 'AND (l.manager_id = $1 OR l.manager_id IS NULL)' : ''}
        ORDER BY l.archived_at DESC NULLS LAST, l.updated_at DESC`, managerParams),
    query(`SELECT st.*, c.name AS course_name, g.name AS group_name, u.full_name AS manager_name,
        sc.name AS school_name,
        ${studentGroupMembershipsSelect('st')},
        (
          SELECT CASE
            WHEN p.status = 'pending' AND p.due_at IS NOT NULL AND p.due_at < NOW() THEN 'overdue'
            ELSE p.status
          END
          FROM academy_payments p
          WHERE p.student_id = st.id
          ORDER BY p.created_at DESC
          LIMIT 1
        ) AS payment_status
      FROM academy_students st
      LEFT JOIN academy_courses c ON c.id = st.course_id
      LEFT JOIN academy_groups g ON g.id = st.group_id
      LEFT JOIN users u ON u.id = st.manager_id
      LEFT JOIN academy_schools sc ON sc.id = st.school_id
      WHERE 1=1 ${isManagerScoped ? 'AND st.manager_id = $1' : ''} ${isTeacherScoped ? `AND EXISTS (
        SELECT 1
        FROM academy_student_group_enrollments teacher_membership
        JOIN academy_groups teacher_group ON teacher_group.id = teacher_membership.group_id
        WHERE teacher_membership.student_id = st.id
          AND teacher_membership.status = 'active'
          AND teacher_group.teacher_id = $1
      )` : ''}
      ORDER BY st.created_at DESC`, isTeacherScoped ? [teacherId] : managerParams),
    query(`SELECT l.*, g.name AS group_name, t.full_name AS teacher_name, c.name AS course_name,
        sc.name AS school_name
      FROM academy_lessons l
      LEFT JOIN academy_groups g ON g.id = l.group_id
      LEFT JOIN academy_teachers t ON t.id = l.teacher_id
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_schools sc ON sc.id = l.school_id
      LEFT JOIN academy_rooms r ON r.id = l.room_id
      WHERE 1=1 ${isTeacherScoped ? 'AND l.teacher_id = $1' : ''}
      ORDER BY l.scheduled_at DESC`, isTeacherScoped ? [teacherId] : []),
    query(`SELECT a.*
      FROM academy_attendance a
      JOIN academy_lessons l ON l.id = a.lesson_id
      WHERE l.status = 'conducted' ${isTeacherScoped ? 'AND l.teacher_id = $1' : ''}`,
    isTeacherScoped ? [teacherId] : []),
    query(`SELECT p.*, st.student_name, l.contact_name AS lead_name
      FROM academy_payments p
      LEFT JOIN academy_students st ON st.id = p.student_id
      LEFT JOIN academy_leads l ON l.id = p.lead_id
      WHERE 1=1
        ${isManagerScoped ? 'AND (st.manager_id = $1 OR p.lead_id IN (SELECT id FROM academy_leads WHERE manager_id = $1))' : ''}
        ${isTeacherScoped ? 'AND FALSE' : ''}
      ORDER BY p.created_at DESC`, isTeacherScoped ? [] : managerParams),
    query(`SELECT t.*, u.full_name AS responsible_name
      FROM academy_tasks t
      LEFT JOIN users u ON u.id = t.responsible_id
      WHERE 1=1 ${isManagerScoped || isTeacherScoped ? 'AND t.responsible_id = $1' : ''}
      ORDER BY COALESCE(t.deadline_at, t.created_at)`,
    isTeacherScoped ? [actor!.userId] : managerParams),
    isTeacherScoped
      ? query(`SELECT ls.*, st.student_name, l.topic AS lesson_topic, g.name AS group_name
        FROM academy_lesson_surveys ls
        JOIN academy_lessons l ON l.id = ls.lesson_id
        LEFT JOIN academy_students st ON st.id = ls.student_id
        LEFT JOIN academy_groups g ON g.id = ls.group_id
        WHERE l.teacher_id = $1
        ORDER BY ls.created_at DESC`, [teacherId])
      : query(`SELECT ls.*, st.student_name, l.topic AS lesson_topic, g.name AS group_name
        FROM academy_lesson_surveys ls
        LEFT JOIN academy_students st ON st.id = ls.student_id
        LEFT JOIN academy_lessons l ON l.id = ls.lesson_id
        LEFT JOIN academy_groups g ON g.id = ls.group_id
        ORDER BY ls.created_at DESC`),
    isTeacherScoped
      ? query(`SELECT ps.*
        FROM academy_parent_surveys ps
        JOIN academy_students st ON st.id = ps.student_id
        WHERE EXISTS (
          SELECT 1
          FROM academy_student_group_enrollments teacher_membership
          JOIN academy_groups teacher_group ON teacher_group.id = teacher_membership.group_id
          WHERE teacher_membership.student_id = st.id
            AND teacher_membership.status = 'active'
            AND teacher_group.teacher_id = $1
        )
        ORDER BY ps.created_at DESC`, [teacherId])
      : isManagerScoped
        ? query(`SELECT ps.*
          FROM academy_parent_surveys ps
          JOIN academy_students st ON st.id = ps.student_id
          WHERE st.manager_id = $1
          ORDER BY ps.created_at DESC`, managerParams)
        : query(`SELECT * FROM academy_parent_surveys ORDER BY created_at DESC`),
    isManagerScoped || isTeacherScoped
      ? Promise.resolve([])
      : query(`SELECT * FROM academy_marketing_expenses WHERE status = 'approved' ORDER BY period_start DESC`),
    isTeacherScoped
      ? query(`SELECT p.*
        FROM academy_portfolio_projects p
        JOIN academy_groups g ON g.id = p.group_id
        WHERE g.teacher_id = $1
        ORDER BY p.created_at DESC`, [teacherId])
      : isManagerScoped
        ? query(`SELECT p.*
          FROM academy_portfolio_projects p
          JOIN academy_students st ON st.id = p.student_id
          WHERE st.manager_id = $1
          ORDER BY p.created_at DESC`, managerParams)
        : query(`SELECT * FROM academy_portfolio_projects ORDER BY created_at DESC`),
    isManagerScoped
      ? query(`SELECT rr.*
        FROM academy_referral_rewards rr
        LEFT JOIN academy_students referrer ON referrer.id = rr.referrer_student_id
        LEFT JOIN academy_students referred ON referred.id = rr.referred_student_id
        WHERE referrer.manager_id = $1 OR referred.manager_id = $1
        ORDER BY rr.created_at DESC`, managerParams)
      : isTeacherScoped
        ? Promise.resolve([])
        : query(`SELECT * FROM academy_referral_rewards ORDER BY created_at DESC`),
    isManagerScoped
      ? query(`SELECT benefit.*
        FROM academy_referral_benefits benefit
        JOIN academy_students student ON student.id = benefit.student_id
        WHERE student.manager_id = $1
        ORDER BY benefit.created_at DESC`, managerParams)
      : isTeacherScoped
        ? Promise.resolve([])
        : query(`SELECT * FROM academy_referral_benefits ORDER BY created_at DESC`),
  ]);

  const [visibleLeads, visibleArchivedLeads] = await Promise.all([
    applyLeadVisibilityForActor(actor, leads),
    applyLeadVisibilityForActor(actor, archivedLeads),
  ]);
  return {
    schools,
    rooms,
    courses,
    sources,
    statuses,
    teachers,
    groups,
    leads: visibleLeads,
    archivedLeads: visibleArchivedLeads,
    students,
    lessons,
    attendance,
    payments,
    tasks,
    lessonSurveys,
    parentSurveys,
    expenses,
    projects,
    referrals,
    referralBenefits,
  };
};

export const getValidDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const expenseAmountInsidePeriod = (
  expense: Row,
  periodStart: Date,
  periodEndExclusive: Date,
): number => {
  const rawExpenseStart = getValidDate(expense.periodStart);
  const rawExpenseEnd = getValidDate(expense.periodEnd);
  if (!rawExpenseStart || !rawExpenseEnd || rawExpenseEnd < rawExpenseStart) return 0;

  // Marketing expense periods are inclusive calendar dates. Converting the end
  // to an exclusive boundary makes overlapping multi-month expenses contribute
  // proportionally instead of being counted in full in every touched month.
  // These date-only fields are stored as UTC-naive timestamps; map their UTC
  // YYYY-MM-DD fields back to Tashkent midnights before comparing periods.
  const expenseStart = getZonedDateOnlyRange(rawExpenseStart, ACADEMY_TIME_ZONE).start;
  const expenseEndExclusive = getZonedDateOnlyRange(rawExpenseEnd, ACADEMY_TIME_ZONE).end;
  const overlapStart = Math.max(expenseStart.getTime(), periodStart.getTime());
  const overlapEnd = Math.min(expenseEndExclusive.getTime(), periodEndExclusive.getTime());
  if (overlapEnd <= overlapStart) return 0;

  const expenseDuration = expenseEndExclusive.getTime() - expenseStart.getTime();
  if (expenseDuration <= 0) return 0;
  return Number(expense.amountUzs || 0) * ((overlapEnd - overlapStart) / expenseDuration);
};

export const hasStudentRiskFlag = (student: Row, flag: string) => {
  if (Array.isArray(student.riskFlags)) return student.riskFlags.includes(flag);
  if (typeof student.riskFlags !== 'string') return false;
  try {
    const parsed = JSON.parse(student.riskFlags);
    return Array.isArray(parsed) && parsed.includes(flag);
  } catch {
    return false;
  }
};

export const studentBelongsToGroup = (student: Row, groupId: number) => {
  if (Array.isArray(student.groupIds)) {
    return student.groupIds.some((candidate: unknown) => Number(candidate) === Number(groupId));
  }
  return Number(student.groupId) === Number(groupId);
};

export const studentBelongsToCourse = (student: Row, courseId: number) => {
  if (Array.isArray(student.groups) && student.groups.length > 0) {
    return student.groups.some((group: Row) => Number(group.courseId) === Number(courseId));
  }
  return Number(student.courseId) === Number(courseId);
};

export const buildAnalytics = async (reportingRange: ReportingRange | null = null) => {
  const [data, companySettings] = await Promise.all([getAcademyDataset(), getCompanySettings()]);
  const targets = toAnalyticsTargets(companySettings);
  const now = new Date();
  const weekStart = addDays(now, -7);
  const { start: monthStart, end: nextMonthStart } = getZonedMonthRange(
    now,
    ACADEMY_TIME_ZONE,
  );
  const metricStart = reportingRange?.start ?? monthStart;
  const metricEnd = reportingRange?.end ?? nextMonthStart;
  const valueInMetricRange = (value: unknown) => {
    const date = getValidDate(value);
    return date !== null && date >= metricStart && date < metricEnd;
  };
  const periodLeads = data.leads.filter((lead) => valueInMetricRange(lead.createdAt));
  const periodLessons = data.lessons.filter((lesson) => valueInMetricRange(lesson.scheduledAt));
  const periodLessonIds = new Set(periodLessons.map((lesson) => Number(lesson.id)));
  const periodAttendance = data.attendance.filter((record) => periodLessonIds.has(Number(record.lessonId)));
  const periodLessonSurveys = data.lessonSurveys.filter((survey) => valueInMetricRange(survey.createdAt));
  const periodParentSurveys = data.parentSurveys.filter((survey) => valueInMetricRange(survey.createdAt));

  const paidPayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'paid');
  const periodPaidPayments = paidPayments.filter((payment) => valueInMetricRange(payment.paidAt));
  const studentById = new Map(data.students.map((student) => [Number(student.id), student]));
  const leadById = new Map(data.leads.map((lead) => [Number(lead.id), lead]));
  const leadIdForPayment = (payment: Row): number | null => {
    const directLeadId = Number(payment.leadId);
    if (Number.isInteger(directLeadId) && directLeadId > 0) return directLeadId;
    const studentId = Number(payment.studentId);
    const studentLeadId = Number(studentById.get(studentId)?.leadId);
    return Number.isInteger(studentLeadId) && studentLeadId > 0 ? studentLeadId : null;
  };
  const customerKeyForPayment = (payment: Row): string | null => {
    const leadId = leadIdForPayment(payment);
    if (leadId) return `lead:${leadId}`;
    const studentId = Number(payment.studentId);
    return Number.isInteger(studentId) && studentId > 0 ? `student:${studentId}` : null;
  };
  const firstPaidAtByCustomer = new Map<string, Date>();
  const paidLeadIds = new Set<number>();
  const paidStudentIds = new Set<number>();
  for (const payment of paidPayments) {
    const leadId = leadIdForPayment(payment);
    if (leadId && leadById.has(leadId)) paidLeadIds.add(leadId);
    const studentId = Number(payment.studentId);
    if (Number.isInteger(studentId) && studentId > 0) paidStudentIds.add(studentId);
    const customerKey = customerKeyForPayment(payment);
    const paidAt = getValidDate(payment.paidAt);
    if (!customerKey || !paidAt) continue;
    const previous = firstPaidAtByCustomer.get(customerKey);
    if (!previous || paidAt < previous) firstPaidAtByCustomer.set(customerKey, paidAt);
  }
  const newPaidCustomersThisMonth = new Set(
    [...firstPaidAtByCustomer.entries()]
      .filter(([, paidAt]) => paidAt >= metricStart && paidAt < metricEnd)
      .map(([customerKey]) => customerKey),
  );
  const revenueMonth = periodPaidPayments
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const revenueTotal = paidPayments.reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const avgCheck = calculateAverage(periodPaidPayments.map((payment) => Number(payment.amountUzs || 0))) ?? 0;
  const expensesMonth = data.expenses
    .reduce((sum, expense) => sum + expenseAmountInsidePeriod(expense, metricStart, metricEnd), 0);
  const cac = calculateCac(expensesMonth, newPaidCustomersThisMonth.size) ?? 0;
  const roas = calculateRoas(revenueMonth, expensesMonth) ?? 0;
  const ltvByStudent = data.students.map((student) => ({
    studentId: student.id,
    ltv: calculateLtv(paidPayments
      .filter((payment) => Number(payment.studentId) === Number(student.id))
      .map((payment) => Number(payment.amountUzs || 0))) }));
  const averageLtv = calculateAverage(ltvByStudent.map((item) => item.ltv)) ?? 0;
  const overduePayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'overdue');
  const overdueTasks = data.tasks.filter((task) => task.status !== 'done' && task.deadlineAt && new Date(task.deadlineAt) < now);
  const activeStudentsWithAttendance = data.students.filter((student) => (
    student.status === 'studying'
    && (
      Number(student.attendancePercent || 0) > 0
      || hasStudentRiskFlag(student, 'attendance_below_70')
    )
  ));
  const lowAttendanceStudents = data.students.filter((student) => (
    student.status === 'studying'
    && (
      hasStudentRiskFlag(student, 'attendance_below_70')
      || (Number(student.attendancePercent || 0) > 0 && Number(student.attendancePercent || 0) < targets.attendance)
    )
  ));
  const lowScores = periodLessonSurveys.filter((survey) => Number(survey.score) < 3);
  const longThinkingLeads = data.leads.filter((lead) =>
    lead.statusCode === 'thinking' && lead.updatedAt && new Date(lead.updatedAt) < addDays(now, -7)
  );
  const nps = calculateNps(periodParentSurveys.map((survey) => Number(survey.npsScore)).filter(Number.isFinite)) ?? 0;
  const churnByReason = data.students
    .filter((student) => ['paused', 'expelled'].includes(String(student.status))
      && student.exitReason
      && student.updatedAt
      && new Date(student.updatedAt) >= metricStart
      && new Date(student.updatedAt) < metricEnd)
    .reduce<Record<string, number>>((acc, student) => {
      const reason = String(student.exitReason);
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  const activePipelineStatuses = [...data.statuses]
    .filter((status) => status.isActive !== false && status.isPipeline !== false)
    .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder));
  const activePipelineStatusCodes = new Set(activePipelineStatuses.map((status) => String(status.code)));
  const activePipelineStatusIndex = new Map(
    activePipelineStatuses.map((status, index) => [String(status.code), index]),
  );
  const reachedStageCount = (leads: Row[], stageIndex: number) => leads.filter((lead) => {
    const currentIndex = activePipelineStatusIndex.get(String(lead.statusCode));
    return currentIndex !== undefined && currentIndex >= stageIndex;
  }).length;
  // A conversion funnel is cumulative: every lead at a later stage has also
  // reached all earlier stages. Exact-status counts could make a later stage
  // larger than the preceding one and produce conversion above 100%.
  const funnel = activePipelineStatuses.map((status, stageIndex) => ({
    ...status,
    count: reachedStageCount(periodLeads, stageIndex) }));
  const funnelBySource = Object.fromEntries(data.sources.map((source) => {
    const sourceLeads = periodLeads.filter((lead) => Number(lead.sourceId) === Number(source.id));
    return [String(source.id), activePipelineStatuses.map((status, stageIndex) => ({
      ...status,
      count: reachedStageCount(sourceLeads, stageIndex),
    }))];
  }));

  const groupsWithCapacity = data.groups.map((group) => ({
    ...group,
    currentStudents: Number(group.currentStudents || 0),
    capacityLabel: `${Number(group.currentStudents || 0)}/${Number(group.maxStudents || 12)}`,
    isFull: Number(group.currentStudents || 0) >= Number(group.maxStudents || 12) }));

  const teacherHours = periodLessons
    .filter((lesson) => lesson.status === 'conducted')
    .reduce((sum, lesson) => sum + Number(lesson.durationMinutes || 120) / 60, 0);

  // --- Marketing metrics (TZ 4.2): conversions, CPL, deal cycle, warm-base conversion. ---
  const newRequestCount = periodLeads.length;
  const invitedToDemoCount = periodLeads.filter((lead) =>
    ['demo_invited', 'demo_attended', 'offer', 'thinking', 'enrolled', 'paid'].includes(lead.statusCode)
    || lead.demoAttended).length;
  const paidAfterDemoCount = periodLeads.filter((lead) =>
    paidLeadIds.has(Number(lead.id))
    && (['demo_invited', 'demo_attended', 'offer', 'thinking', 'enrolled', 'paid'].includes(lead.statusCode)
      || lead.demoAttended),
  ).length;
  const leadToDemoConversion = newRequestCount > 0 ? Number(((invitedToDemoCount / newRequestCount) * 100).toFixed(1)) : 0;
  const demoToPaidConversion = invitedToDemoCount > 0 ? Number(((paidAfterDemoCount / invitedToDemoCount) * 100).toFixed(1)) : 0;
  const paidPeriodLeadCount = periodLeads.filter((lead) => paidLeadIds.has(Number(lead.id))).length;
  const leadToPaidConversion = newRequestCount > 0 ? Number(((paidPeriodLeadCount / newRequestCount) * 100).toFixed(1)) : 0;
  const newLeadsMonth = periodLeads;
  const cpl = newLeadsMonth.length > 0 ? Math.round(expensesMonth / newLeadsMonth.length) : 0;
  // Average deal cycle (days) from lead creation to first paid payment.
  const firstPaidAtByLead = new Map<number, Date>();
  for (const payment of paidPayments) {
    const leadId = leadIdForPayment(payment);
    const paidAt = getValidDate(payment.paidAt);
    if (!leadId || !paidAt) continue;
    const previous = firstPaidAtByLead.get(leadId);
    if (!previous || paidAt < previous) firstPaidAtByLead.set(leadId, paidAt);
  }
  const dealCycleDays = periodLeads
    .map((lead) => {
      const firstPaidAt = firstPaidAtByLead.get(Number(lead.id));
      const createdAt = getValidDate(lead.createdAt);
      if (!firstPaidAt || !createdAt || firstPaidAt < createdAt) return null;
      return (firstPaidAt.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
    })
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const avgDealCycleDays = calculateAvgDealCycleDays(dealCycleDays) ?? 0;

  // --- Operations metrics (TZ 4.3): lesson NPS by teacher/course/group, progress, teacher hours, retention %. ---
  const lessonScores = periodLessonSurveys.map((survey) => Number(survey.score)).filter(Number.isFinite);
  const avgLessonScore = calculateAverage(lessonScores) ?? 0;
  const byTeacher = data.teachers.map((teacher) => {
    const teacherLessons = periodLessons.filter((lesson) => Number(lesson.teacherId) === Number(teacher.id) && lesson.status === 'conducted');
    const teacherLessonIds = new Set(teacherLessons.map((lesson) => Number(lesson.id)));
    const teacherAttendance = periodAttendance.filter((record) => teacherLessonIds.has(Number(record.lessonId)));
    const teacherSurveys = periodLessonSurveys.filter((survey) => Number(survey.teacherId) === Number(teacher.id));
    const scoresByDate = [...teacherSurveys]
      .sort((left, right) => (getValidDate(left.createdAt)?.getTime() ?? 0) - (getValidDate(right.createdAt)?.getTime() ?? 0))
      .map((survey) => Number(survey.score))
      .filter(Number.isFinite);
    return {
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      hours: teacherLessons.reduce((sum, lesson) => sum + Number(lesson.durationMinutes || 120) / 60, 0),
      avgScore: calculateAverage(scoresByDate) ?? 0,
      attendance: teacherAttendance.length > 0
        ? Math.round(
            (teacherAttendance.filter((record) => record.status === 'present').length / teacherAttendance.length) * 100,
          )
        : 0,
      groupsCount: data.groups.filter((group) => Number(group.teacherId) === Number(teacher.id)).length,
      trend: calculateTrend(scoresByDate),
    };
  });
  const byCourseLessonNps = data.courses.map((course) => {
    const courseSurveys = periodLessonSurveys.filter((survey) => Number(survey.courseId) === Number(course.id));
    const scores = [...courseSurveys]
      .sort((left, right) => (getValidDate(left.createdAt)?.getTime() ?? 0) - (getValidDate(right.createdAt)?.getTime() ?? 0))
      .map((survey) => Number(survey.score))
      .filter(Number.isFinite);
    return {
      courseId: course.id,
      courseName: course.name,
      avgLessonScore: calculateAverage(scores) ?? 0,
      trend: calculateTrend(scores),
      progressAvg: calculateAverage(
        data.students.filter((student) => studentBelongsToCourse(student, Number(course.id)) && student.status === 'studying')
          .map((student) => Number(student.progressPercent || 0)).filter(Number.isFinite),
      ) ?? 0,
    };
  });
  const byGroupProgress = data.groups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    capacity: Number(group.currentStudents || 0),
    maxCapacity: Number(group.maxStudents || 12),
    attendanceAvg: calculateAverage(
      activeStudentsWithAttendance.filter((student) => (
        studentBelongsToGroup(student, Number(group.id))
      ))
        .map((student) => Number(student.attendancePercent || 0)).filter(Number.isFinite),
    ) ?? 0,
    progressAvg: calculateAverage(
      data.students.filter((student) => (
        studentBelongsToGroup(student, Number(group.id)) && student.status === 'studying'
      ))
        .map((student) => Number(student.progressPercent || 0)).filter(Number.isFinite),
    ) ?? 0,
  }));

  // --- Retention by course: completed students are successful outcomes, while
  // paused/expelled students represent churn from the enrolled cohort. ---
  const retentionByCourse = data.courses.map((course) => {
    const courseStudents = data.students.filter((student) => studentBelongsToCourse(student, Number(course.id)));
    const retainedStudents = courseStudents.filter((student) => (
      student.status === 'studying' || student.status === 'completed'
    ));
    const monthsValues = courseStudents
      .filter((student) => student.enrolledAt)
      .map((student) => (now.getTime() - new Date(student.enrolledAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
    return {
      courseId: course.id,
      courseName: course.name,
      retentionPercent: courseStudents.length > 0
        ? Math.round((retainedStudents.length / courseStudents.length) * 100)
        : 0,
      avgStudyMonths: calculateAvgStudyMonths(monthsValues) ?? 0,
      studentCount: courseStudents.length,
    };
  });

  return {
    summary: {
      newLeadsWeek: reportingRange
        ? periodLeads.length
        : data.leads.filter((lead) => new Date(lead.createdAt) >= weekStart).length,
      newLeadsMonth: newLeadsMonth.length,
      activeLeads: periodLeads.filter((lead) => activePipelineStatusCodes.has(String(lead.statusCode))).length,
      activeStudents: data.students.filter((student) => student.status === 'studying').length,
      revenueMonth,
      revenueTotal,
      avgCheck,
      cac,
      roas,
      cpl,
      averageLtv,
      ltvCac: cac ? Number((averageLtv / cac).toFixed(2)) : 0,
      avgAttendance: periodAttendance.length > 0
        ? Math.round(
            (periodAttendance.filter((record) => record.status === 'present').length / periodAttendance.length) * 100,
          )
        : 0,
      attendanceMarks: periodAttendance.length,
      avgLessonScore,
      nps,
      npsBelowTarget: nps < targets.nps,
      teacherHours,
      avgDealCycleDays,
      leadToDemoConversion,
      demoToPaidConversion,
      leadToPaidConversion,
      overduePayments: overduePayments.length,
      overdueTasks: overdueTasks.length,
      newPaidStudents: newPaidCustomersThisMonth.size },
    funnel,
    funnelBySource,
    groups: groupsWithCapacity,
    risks: {
      lowAttendanceStudents,
      lowScores,
      overduePayments,
      longThinkingLeads,
      overdueTasks },
    byCourse: data.courses.map((course) => {
      const coursePaidCustomers = new Set(periodPaidPayments
        .filter((payment) => {
          const studentCourseId = studentById.get(Number(payment.studentId))?.courseId;
          const leadCourseId = leadById.get(Number(leadIdForPayment(payment)))?.courseId;
          return Number(studentCourseId ?? leadCourseId) === Number(course.id);
        })
        .map(customerKeyForPayment)
        .filter((key): key is string => Boolean(key)));
      const courseExpenses = data.expenses.reduce((sum, expense) => {
        const sourceLeads = periodLeads.filter((lead) => Number(lead.sourceId) === Number(expense.sourceId));
        if (sourceLeads.length === 0) return sum;
        const courseLeadCount = sourceLeads.filter((lead) => Number(lead.courseId) === Number(course.id)).length;
        const recognizedExpense = expenseAmountInsidePeriod(expense, metricStart, metricEnd);
        return sum + (recognizedExpense * courseLeadCount) / sourceLeads.length;
      }, 0);
      return {
        courseId: course.id,
        courseName: course.name,
        leads: periodLeads.filter((lead) => Number(lead.courseId) === Number(course.id)).length,
        students: data.students.filter((student) => studentBelongsToCourse(student, Number(course.id)) && student.status === 'studying').length,
        revenue: periodPaidPayments
          .filter((payment) => {
            const studentCourseId = studentById.get(Number(payment.studentId))?.courseId;
            const leadCourseId = leadById.get(Number(leadIdForPayment(payment)))?.courseId;
            return Number(studentCourseId ?? leadCourseId) === Number(course.id);
          })
          .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
        averageLtv: calculateAverage(
          ltvByStudent
            .filter((item) => Number(studentById.get(Number(item.studentId))?.courseId) === Number(course.id))
            .map((item) => item.ltv),
        ) ?? 0,
        ltvTargetMinUzs: course.ltvTargetMinUzs,
        ltvTargetMaxUzs: course.ltvTargetMaxUzs,
        cac: calculateCac(courseExpenses, coursePaidCustomers.size) ?? 0 };
    }),
    bySource: data.sources.map((source) => {
      const sourceLeads = periodLeads.filter((lead) => Number(lead.sourceId) === Number(source.id));
      const sourceLeadIds = new Set(sourceLeads.map((lead) => Number(lead.id)));
      const sourceStudents = data.students.filter((student) => sourceLeadIds.has(Number(student.leadId)));
      const paidSourceStudents = sourceStudents.filter((student) => paidStudentIds.has(Number(student.id)));
      const paidSourceLeadIds = new Set([...paidLeadIds].filter((leadId) => sourceLeadIds.has(leadId)));
      const sourceRevenue = periodPaidPayments
        .filter((payment) => {
          const leadId = leadIdForPayment(payment);
          return leadId !== null && sourceLeadIds.has(leadId);
        })
        .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
      const sourceExpenses = data.expenses
        .filter((expense) => Number(expense.sourceId) === Number(source.id))
        .reduce((sum, expense) => sum + expenseAmountInsidePeriod(expense, metricStart, metricEnd), 0);
      const sourceCac = calculateCac(sourceExpenses, paidSourceLeadIds.size) ?? 0;
      return {
        sourceId: source.id,
        sourceName: source.name,
        leads: sourceLeads.length,
        paidStudents: paidSourceLeadIds.size,
        revenue: sourceRevenue,
        expenses: sourceExpenses,
        cpl: sourceLeads.length > 0 ? Math.round(sourceExpenses / sourceLeads.length) : 0,
        cac: sourceCac,
        roas: calculateRoas(sourceRevenue, sourceExpenses) ?? 0,
        ltvCac: sourceCac ? Number(((calculateAverage(paidSourceStudents.map((student) => ltvByStudent.find((item) => Number(item.studentId) === Number(student.id))?.ltv || 0)) ?? 0) / sourceCac).toFixed(2)) : 0 };
    }),
    byTeacher,
    byCourseLessonNps,
    byGroupProgress,
    retentionByCourse,
    churnByReason,
    targets,
    reportingRange: reportingRange
      ? { from: reportingRange.from, to: reportingRange.to }
      : { from: academyDateOnlyKey(monthStart), to: academyDateOnlyKey(new Date(nextMonthStart.getTime() - 1)) },
    data };
};

export const buildAdministrationDashboard = async (requestedRange: ReportingRange | null = null) => {
  const now = new Date();
  const defaultMonth = getZonedMonthRange(now, ACADEMY_TIME_ZONE);
  const currentRange: ReportingRange = requestedRange ?? {
    start: defaultMonth.start,
    end: defaultMonth.end,
    from: academyDateOnlyKey(defaultMonth.start),
    to: academyDateOnlyKey(new Date(defaultMonth.end.getTime() - 1)),
  };
  const rangeDuration = currentRange.end.getTime() - currentRange.start.getTime();
  const previousRange = {
    start: new Date(currentRange.start.getTime() - rangeDuration),
    end: currentRange.start,
  };
  const [analytics, users, escalatedTasks] = await Promise.all([
    buildAnalytics(currentRange),
    storage.getUsers(),
    query(`SELECT t.id, t.title, t.deadline_at, u.full_name AS responsible_name
           FROM academy_tasks t
           LEFT JOIN users u ON u.id = t.responsible_id
           WHERE t.status <> 'done' AND t.escalated_at IS NOT NULL
           ORDER BY t.escalated_at DESC
           LIMIT 20`),
  ]);
  const data = analytics.data;
  const currentMonthStart = currentRange.start;
  const nextMonthStart = currentRange.end;
  const previousMonthStart = previousRange.start;
  const activeGroups = data.groups.filter((group) => ['open', 'in_progress'].includes(group.status));
  const activeTeachers = data.teachers.filter((teacher) => teacher.status === 'active');
  const activeUsers = users.filter((user) => user.isActive);
  const onlineUsers = activeUsers.filter((user) => user.isOnline);

  const percentageChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Number((((current - previous) / previous) * 100).toFixed(1));
  };

  const inRange = (value: unknown, start: Date, end: Date) => {
    if (!value) return false;
    const date = new Date(String(value));
    return !Number.isNaN(date.getTime()) && date >= start && date < end;
  };

  const paidPayments = data.payments.filter(
    (payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'paid' && payment.paidAt,
  );
  const currentMonthRevenue = paidPayments
    .filter((payment) => inRange(payment.paidAt, currentMonthStart, nextMonthStart))
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const previousMonthRevenue = paidPayments
    .filter((payment) => inRange(payment.paidAt, previousMonthStart, currentMonthStart))
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const currentMonthLeads = data.leads.filter(
    (lead) => inRange(lead.createdAt, currentMonthStart, nextMonthStart),
  ).length;
  const previousMonthLeads = data.leads.filter(
    (lead) => inRange(lead.createdAt, previousMonthStart, currentMonthStart),
  ).length;
  const currentMonthStudents = data.students.filter(
    (student) => inRange(student.enrolledAt || student.createdAt, currentMonthStart, nextMonthStart),
  ).length;
  const previousMonthStudents = data.students.filter(
    (student) => inRange(student.enrolledAt || student.createdAt, previousMonthStart, currentMonthStart),
  ).length;

  const trends = reportingBuckets(currentRange).map(({ start, end, periodStart }) => {
    return {
      periodStart,
      revenue: paidPayments
        .filter((payment) => inRange(payment.paidAt, start, end))
        .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
      students: data.students.filter(
        (student) => inRange(student.enrolledAt || student.createdAt, start, end),
      ).length,
      leads: data.leads.filter((lead) => inRange(lead.createdAt, start, end)).length,
    };
  });

  const courseLoad = data.courses
    .map((course) => {
      const courseGroups = activeGroups.filter((group) => Number(group.courseId) === Number(course.id));
      const capacity = courseGroups.reduce((sum, group) => sum + Number(group.maxStudents || 0), 0);
      const students = data.students.filter(
        (student) => studentBelongsToCourse(student, Number(course.id)) && student.status === 'studying',
      ).length;
      return {
        courseId: course.id,
        courseName: course.name,
        groups: courseGroups.length,
        students,
        capacity,
        loadPercent: capacity > 0 ? Math.min(100, Math.round((students / capacity) * 100)) : 0,
      };
    })
    .filter((course) => course.groups > 0 || course.students > 0)
    .sort((left, right) => right.students - left.students)
    .slice(0, 6);

  const today = getZonedDayRange(now, ACADEMY_TIME_ZONE);
  const tomorrow = getZonedDayRange(now, ACADEMY_TIME_ZONE, 1);
  const nonCancelledLessons = data.lessons.filter((lesson) =>
    lesson.status !== 'cancelled' && getValidDate(lesson.scheduledAt));
  const scheduledLessons = nonCancelledLessons.filter((lesson) =>
    lesson.status === 'scheduled' && new Date(lesson.scheduledAt) >= now);
  const upcomingLessons = [...scheduledLessons]
    .sort((left, right) =>
      new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime())
    .slice(0, 5)
    .map((lesson) => ({
      id: lesson.id,
      topic: lesson.topic,
      groupName: lesson.groupName,
      courseName: lesson.courseName,
      teacherName: lesson.teacherName,
      schoolName: lesson.schoolName,
      scheduledAt: lesson.scheduledAt,
    }));

  const recentActivity = [
    ...data.payments
      .filter((payment) => payment.status === 'paid' && payment.paidAt)
      .map((payment) => ({
        id: `payment-${payment.id}`,
        type: 'payment',
        occurredAt: payment.paidAt,
        subject: payment.studentName || payment.leadName,
        amountUzs: Number(payment.amountUzs || 0),
      })),
    ...data.leads.map((lead) => ({
      id: `lead-${lead.id}`,
      type: 'lead',
      occurredAt: lead.createdAt,
      subject: lead.contactName,
      meta: lead.courseName,
    })),
    ...data.students.map((student) => ({
      id: `student-${student.id}`,
      type: 'student',
      occurredAt: student.enrolledAt || student.createdAt,
      subject: student.studentName || student.contactName,
      meta: student.courseName,
    })),
    ...data.groups.map((group) => ({
      id: `group-${group.id}`,
      type: 'group',
      occurredAt: group.createdAt,
      subject: group.name,
      meta: group.courseName,
    })),
  ]
    .filter((item) => item.occurredAt)
    .filter((item) => inRange(item.occurredAt, currentRange.start, currentRange.end))
    .sort((left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 6);

  const overdueAmount = analytics.risks.overduePayments.reduce(
    (sum: number, payment: Row) => sum + Number(payment.amountUzs || 0),
    0,
  );
  const groupsWithoutTeacher = activeGroups.filter((group) => !group.teacherId).length;
  const totalActiveCapacity = activeGroups.reduce(
    (sum, group) => sum + Number(group.maxStudents || 0),
    0,
  );
  const occupiedActiveSeats = activeGroups.reduce(
    (sum, group) => sum + Number(group.currentStudents || 0),
    0,
  );
  const churnByReason = data.students
    .filter((student) => ['paused', 'expelled'].includes(String(student.status))
      && student.exitReason
      && inRange(student.updatedAt, currentMonthStart, nextMonthStart))
    .reduce<Record<string, number>>((acc, student) => {
      const reason = String(student.exitReason);
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  return {
    summary: {
      ...analytics.summary,
      activeGroups: activeGroups.length,
      activeTeachers: activeTeachers.length,
      activeUsers: activeUsers.length,
      totalUsers: users.length,
      onlineUsers: onlineUsers.length,
      newStudentsMonth: currentMonthStudents,
      groupLoadPercent: totalActiveCapacity > 0
        ? Math.min(100, Math.round((occupiedActiveSeats / totalActiveCapacity) * 100))
        : 0,
      lessonsToday: nonCancelledLessons.filter((lesson) =>
        inRange(lesson.scheduledAt, today.start, today.end)).length,
      lessonsTomorrow: nonCancelledLessons.filter((lesson) =>
        inRange(lesson.scheduledAt, tomorrow.start, tomorrow.end)).length,
      revenueChangePercent: percentageChange(currentMonthRevenue, previousMonthRevenue),
      leadsChangePercent: percentageChange(currentMonthLeads, previousMonthLeads),
      studentsChangePercent: percentageChange(currentMonthStudents, previousMonthStudents),
      overdueAmount,
      groupsWithoutTeacher,
    },
    trends,
    funnel: analytics.funnel,
    courseLoad,
    targets: analytics.targets,
    alerts: {
      overduePayments: analytics.risks.overduePayments.length,
      lowAttendanceStudents: analytics.risks.lowAttendanceStudents.length,
      overdueTasks: escalatedTasks.length,
      longThinkingLeads: analytics.risks.longThinkingLeads.length,
      groupsWithoutTeacher,
    },
    recentActivity,
    upcomingLessons,
    churnByReason,
    escalatedTasks,
    reportingRange: { from: currentRange.from, to: currentRange.to },
    generatedAt: now.toISOString(),
  };
};

export const getMarketingModuleDataset = async () => {
  const [sources, leads, students, expenses, referrals, referralBenefits] = await Promise.all([
    query(`SELECT * FROM academy_lead_sources WHERE is_active = true ORDER BY name`),
    query(`SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, u.full_name AS manager_name,
        ${leadTagsSelect('l')}
      FROM academy_leads l
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_lead_sources s ON s.id = l.source_id AND s.is_active = true
      LEFT JOIN users u ON u.id = l.manager_id
      WHERE COALESCE(l.is_archived, false) = false
      ORDER BY l.created_at DESC`),
    query(`SELECT id, student_name, contact_name, referral_code, referral_level
      FROM academy_students
      ORDER BY created_at DESC`),
    query(`SELECT * FROM academy_marketing_expenses ORDER BY period_start DESC`),
    query(`SELECT * FROM academy_referral_rewards ORDER BY created_at DESC`),
    query(`SELECT * FROM academy_referral_benefits ORDER BY created_at DESC`),
  ]);

  return { sources, leads, students, expenses, referrals, referralBenefits };
};

export const buildMarketingAnalyticsPayload = (analytics: Row) => ({
  summary: {
    newLeadsWeek: analytics.summary.newLeadsWeek,
    newLeadsMonth: analytics.summary.newLeadsMonth,
    leadToDemoConversion: analytics.summary.leadToDemoConversion,
    demoToPaidConversion: analytics.summary.demoToPaidConversion,
    leadToPaidConversion: analytics.summary.leadToPaidConversion,
    cpl: analytics.summary.cpl,
    cac: analytics.summary.cac,
    roas: analytics.summary.roas,
    avgDealCycleDays: analytics.summary.avgDealCycleDays,
    newPaidStudents: analytics.summary.newPaidStudents,
  },
  funnel: analytics.funnel,
  funnelBySource: analytics.funnelBySource,
  bySource: analytics.bySource,
  leadToDemoConversion: analytics.summary.leadToDemoConversion,
  demoToPaidConversion: analytics.summary.demoToPaidConversion,
  leadToPaidConversion: analytics.summary.leadToPaidConversion,
  cpl: analytics.summary.cpl,
  avgDealCycleDays: analytics.summary.avgDealCycleDays,
  targets: analytics.targets,
  reportingRange: analytics.reportingRange,
});
