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
import { normalizeOutboxRecipient } from '../../services/message-recipients';
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
  ACADEMY_SCHEDULING_ADVISORY_LOCK,
  OPERATIONS_MODULES,
  Row,
  SALES_MODULES,
  createAudit,
  createNotification,
  createTask,
  createTaskOnce,
  ensureAdministrationModuleAccess,
  ensureOperationsAccess,
  ensureSalesAccess,
  ensureModuleAccess,
  insertRow,
  leadershipUserAccessSql,
  logIntegration,
  nullableText,
  parseId,
  parseOptionalDate,
  query,
  queryOne,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  advanceStudentNextPaymentAt,
  applyReferralRewards,
  consumeReferralBenefit,
  createStageHistory,
  createStudentFromLead,
  ensureReferralBenefit,
  getLead,
  handleLeadStatusEffects,
  recalculateStudentMetrics,
  validateEnrollmentGroup,
} from './academy-leads';
import {
  getLeadCountForStatusCode,
} from './academy-route-support';

export const registerAcademyOperationsRoutes = (router: ReturnType<typeof Router>) => {
router.post('/payments', async (req, res) => {
  if (!ensureModuleAccess(req, res, SALES_MODULES, 'Payment access required')) return;
  try {
    const amountUzs = normalizeMoney(req.body.amountUzs);
    const leadId = parseId(req.body.leadId);
    const studentId = parseId(req.body.studentId);
    const requestedPaymentId = req.body.paymentId === undefined
      ? null
      : parseId(req.body.paymentId);
    if (req.body.paymentId !== undefined && !requestedPaymentId) {
      return res.status(400).json({ error: 'Invalid payment id' });
    }
    const requestedGroupId = req.body.groupId === undefined || req.body.groupId === null || req.body.groupId === ''
      ? null
      : parseId(req.body.groupId);
    if (req.body.groupId !== undefined && req.body.groupId !== null && req.body.groupId !== '' && !requestedGroupId) {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    if (!amountUzs) return res.status(400).json({ error: 'paymentAmountRequired' });
    if (!leadId && !studentId) return res.status(400).json({ error: 'paymentPartyRequired' });
    const status = nullableText(req.body.status) ?? 'paid';
    if (!['paid', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }
    const paymentType = nullableText(req.body.type) ?? 'full';
    const paymentMethod = nullableText(req.body.method) ?? 'transfer';
    const paymentDiscount = nullableText(req.body.discount) ?? 'none';
    if (!PAYMENT_TYPES.includes(paymentType as typeof PAYMENT_TYPES[number])) {
      return res.status(400).json({ error: 'Invalid payment type' });
    }
    if (!PAYMENT_METHODS.includes(paymentMethod as typeof PAYMENT_METHODS[number])) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }
    if (!PAYMENT_DISCOUNTS.includes(paymentDiscount as typeof PAYMENT_DISCOUNTS[number])) {
      return res.status(400).json({ error: 'Invalid payment discount' });
    }

    const requestedPaidAt = parseOptionalDate(req.body.paidAt, 'paidAt');
    const requestedPaidUntil = parseOptionalDate(req.body.paidUntil, 'paidUntil');
    const requestedDueAt = parseOptionalDate(req.body.dueAt, 'dueAt');
    const paymentPeriod = nullableText(req.body.period) ?? 'month_1';
    const paidAt = status === 'paid' ? requestedPaidAt ?? new Date() : requestedPaidAt;
    const paidUntil = requestedPaidUntil
      ?? (status === 'paid' && paidAt instanceof Date ? addDays(paidAt, 30) : null);
    if (
      paidAt instanceof Date
      && paidUntil instanceof Date
      && paidUntil.getTime() < paidAt.getTime()
    ) {
      return res.status(400).json({ error: 'paidUntilBeforePaidAt' });
    }

    const result = await withTransaction(async () => {
      const lead = leadId
        ? await queryOne(`SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [leadId])
        : undefined;
      if (leadId && !lead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      if (lead?.isArchived) {
        throw Object.assign(new Error('archivedLeadMustBeRestoredBeforePayment'), { statusCode: 409 });
      }

      const leadStudents = !studentId && leadId
        ? await query(`SELECT * FROM academy_students WHERE lead_id = $1 ORDER BY id FOR UPDATE`, [leadId])
        : [];
      if (!studentId && leadStudents.length > 1) {
        throw Object.assign(new Error('studentSelectionRequired'), { statusCode: 409 });
      }
      const existingStudent = studentId
        ? await queryOne(`SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`, [studentId])
        : leadStudents[0];
      if (studentId && !existingStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (lead && existingStudent && Number(existingStudent.leadId) !== Number(lead.id)) {
        throw Object.assign(new Error('Payment lead and student do not match'), { statusCode: 400 });
      }
      if (getAssignedModules(req.user).includes('sales') && !hasLeadershipAccess(req.user)) {
        const ownsLead = !lead || Number(lead.managerId) === Number(req.user!.id);
        const ownsStudent = !existingStudent || Number(existingStudent.managerId) === Number(req.user!.id);
        if (!ownsLead || !ownsStudent) {
          throw Object.assign(new Error('Payment access required'), { statusCode: 403 });
        }
      }

      const paymentLeadId = leadId ?? (existingStudent?.leadId ? Number(existingStudent.leadId) : null);
      const resolvedStudentId = existingStudent?.id ?? studentId ?? null;
      let pendingPayment: Row | undefined;
      if (status === 'paid') {
        if (requestedPaymentId) {
          pendingPayment = await queryOne(
            `SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE`,
            [requestedPaymentId],
          );
          if (!pendingPayment) {
            throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
          }
          if (!['pending', 'overdue'].includes(String(pendingPayment.status))) {
            throw Object.assign(new Error('paymentAlreadyFinalized'), { statusCode: 409 });
          }
          const sameLead = !pendingPayment.leadId
            || Number(pendingPayment.leadId) === Number(paymentLeadId);
          const sameStudent = !pendingPayment.studentId
            || Number(pendingPayment.studentId) === Number(resolvedStudentId);
          if (!sameLead || !sameStudent) {
            throw Object.assign(new Error('Payment lead and student do not match'), { statusCode: 400 });
          }
        } else {
          pendingPayment = await queryOne(
            `SELECT *
             FROM academy_payments
             WHERE status IN ('pending', 'overdue')
               AND COALESCE(period, '') = $1
               AND (
                 ($2::int IS NOT NULL AND lead_id = $2)
                 OR ($3::int IS NOT NULL AND student_id = $3)
               )
             ORDER BY due_at NULLS LAST, created_at, id
             LIMIT 1
             FOR UPDATE`,
            [paymentPeriod, paymentLeadId, resolvedStudentId],
          );
        }
      }

      const referralLead = lead ?? (paymentLeadId
        ? await queryOne(
          `SELECT id, referrer_student_id
           FROM academy_leads
           WHERE id = $1`,
          [paymentLeadId],
        )
        : null);
      let effectivePaymentDiscount = req.body.discount === undefined && pendingPayment?.discount
        ? String(pendingPayment.discount)
        : paymentDiscount;
      if (!PAYMENT_DISCOUNTS.includes(effectivePaymentDiscount as typeof PAYMENT_DISCOUNTS[number])) {
        throw Object.assign(new Error('Invalid payment discount'), { statusCode: 400 });
      }

      let firstReferralPaymentEligible = false;
      let pendingDiscountBenefit: Row | undefined;
      if (status === 'paid') {
        const referrerId = referralLead?.referrerStudentId
          ? Number(referralLead.referrerStudentId)
          : null;
        if (referrerId && referrerId !== Number(resolvedStudentId)) {
          const validReferrer = await queryOne(
            `SELECT id FROM academy_students WHERE id = $1 FOR SHARE`,
            [referrerId],
          );
          if (validReferrer) {
            const previousPaidPayment = await queryOne(
              `SELECT id
               FROM academy_payments
               WHERE status = 'paid'
                 AND ($3::int IS NULL OR id <> $3)
                 AND (
                   ($1::int IS NOT NULL AND lead_id = $1)
                   OR ($2::int IS NOT NULL AND student_id = $2)
                 )
               LIMIT 1`,
              [paymentLeadId, resolvedStudentId, pendingPayment?.id ?? null],
            );
            firstReferralPaymentEligible = !previousPaidPayment;
          }
        }

        if (firstReferralPaymentEligible) {
          if (effectivePaymentDiscount === 'none') {
            effectivePaymentDiscount = 'referral_15';
          }
        } else if (
          resolvedStudentId
          && (effectivePaymentDiscount === 'none' || effectivePaymentDiscount === 'referral_15')
        ) {
          pendingDiscountBenefit = await queryOne(
            `SELECT *
             FROM academy_referral_benefits
             WHERE student_id = $1
               AND benefit_type = 'next_payment_discount_15'
               AND status = 'pending'
             LIMIT 1
             FOR UPDATE`,
            [resolvedStudentId],
          );
          if (pendingDiscountBenefit && effectivePaymentDiscount === 'none') {
            effectivePaymentDiscount = 'referral_15';
          }
        }

        if (
          effectivePaymentDiscount === 'referral_15'
          && !firstReferralPaymentEligible
          && !pendingDiscountBenefit
        ) {
          throw Object.assign(new Error('referralDiscountNotAvailable'), { statusCode: 409 });
        }
      } else if (effectivePaymentDiscount === 'referral_15') {
        throw Object.assign(new Error('referralDiscountRequiresPaidPayment'), { statusCode: 409 });
      }

      const paymentValues = {
        leadId: paymentLeadId,
        studentId: resolvedStudentId,
        groupId: existingStudent?.groupId ?? lead?.enrolledGroupId ?? requestedGroupId,
        amountUzs,
        type: paymentType,
        method: paymentMethod,
        paidAt,
        period: paymentPeriod,
        discount: effectivePaymentDiscount,
        status,
        dueAt: requestedDueAt,
        paidUntil,
        comment: nullableText(req.body.comment),
        receiptUrl: nullableText(req.body.receiptUrl),
        confirmedBy: status === 'paid' ? req.user!.id : null,
      };
      const payment = pendingPayment
        ? await updateRow('academy_payments', Number(pendingPayment.id), paymentValues)
        : await insertRow('academy_payments', paymentValues);
      if (!payment) throw Object.assign(new Error('Failed to save payment'), { statusCode: 500 });

      if (pendingDiscountBenefit) {
        await consumeReferralBenefit(Number(pendingDiscountBenefit.id), Number(payment.id));
      }

      if (pendingPayment) {
        await query(
          `UPDATE academy_tasks
           SET status = 'done', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
           WHERE entity_type = 'payment'
             AND entity_id = $1
             AND status <> 'done'`,
          [pendingPayment.id],
        );
      }

      let student = existingStudent ?? null;
      if (status === 'paid' && leadId) {
        student = await createStudentFromLead(req, leadId, payment.id);
      }
      const paidStudentId = student?.id ?? studentId;
      if (status === 'paid' && paidStudentId) {
        if (firstReferralPaymentEligible) {
          await ensureReferralBenefit({
            studentId: Number(paidStudentId),
            benefitType: 'referred_first_payment_discount_15',
            status: effectivePaymentDiscount === 'referral_15' ? 'consumed' : 'superseded',
            sourcePaymentId: Number(payment.id),
            consumedByPaymentId: Number(payment.id),
            consumedAt: new Date(),
          });
        }
        await advanceStudentNextPaymentAt(
          Number(paidStudentId),
          payment.paidUntil ?? paidUntil,
        );
        await applyReferralRewards(req, Number(paidStudentId), paymentLeadId, payment.id);
      }

      await createAudit(
        req,
        pendingPayment ? 'CONFIRM_ACADEMY_PAYMENT' : 'CREATE_ACADEMY_PAYMENT',
        'academy_payment',
        payment.id,
        payment,
        pendingPayment,
      );
      return { payment, student };
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Failed to create payment', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to create payment') });
  }
});

router.post('/surveys/lesson', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const score = Number(req.body.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) return res.status(400).json({ error: 'Score must be from 1 to 5' });
    const lessonId = parseId(req.body.lessonId);
    const studentId = parseId(req.body.studentId);
    if (!lessonId || !studentId) return res.status(400).json({ error: 'Lesson and student are required' });
    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`lesson-survey:${lessonId}:${studentId}`]);
      const lesson = await queryOne(
        `SELECT l.*, t.user_id AS teacher_user_id
         FROM academy_lessons l
         LEFT JOIN academy_teachers t ON t.id = l.teacher_id
         WHERE l.id = $1
         FOR UPDATE OF l`,
        [lessonId],
      );
      if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      const student = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!student) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      const membership = await queryOne<{ belongsToGroup: boolean }>(
        `SELECT (
           EXISTS (
             SELECT 1
             FROM academy_student_group_enrollments enrollment
             WHERE enrollment.student_id = $1
               AND enrollment.group_id = $2
               AND enrollment.enrolled_at <= $3
               AND (enrollment.ended_at IS NULL OR enrollment.ended_at > $3)
           )
           OR (
             NOT EXISTS (
               SELECT 1
               FROM academy_student_group_enrollments dated_enrollment
               WHERE dated_enrollment.student_id = $1
                 AND dated_enrollment.enrolled_at <= $3
                 AND (dated_enrollment.ended_at IS NULL OR dated_enrollment.ended_at > $3)
             )
             AND COALESCE(
               (
                 SELECT transfer.to_group_id
                 FROM academy_student_transfers transfer
                 WHERE transfer.student_id = $1
                   AND transfer.created_at <= $3
                 ORDER BY transfer.created_at DESC, transfer.id DESC
                 LIMIT 1
               ),
               (
                 SELECT first_transfer.from_group_id
                 FROM academy_student_transfers first_transfer
                 WHERE first_transfer.student_id = $1
                 ORDER BY first_transfer.created_at, first_transfer.id
                 LIMIT 1
               ),
               (SELECT group_id FROM academy_students WHERE id = $1)
             ) = $2
           )
         ) AS belongs_to_group`,
        [studentId, lesson.groupId, lesson.scheduledAt],
      );
      if (membership && membership.belongsToGroup !== true) {
        throw Object.assign(new Error('Student does not belong to this lesson group'), { statusCode: 400 });
      }
      if (
        !hasLeadershipAccess(req.user)
        && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('Teacher can submit surveys only for own lessons'), { statusCode: 403 });
      }

      const oldSurvey = await queryOne(
        `SELECT *
         FROM academy_lesson_surveys
         WHERE lesson_id = $1 AND student_id = $2
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [lessonId, studentId],
      );
      const values = {
        groupId: lesson.groupId,
        teacherId: lesson.teacherId,
        courseId: lesson.courseId,
        score,
        liked: nullableText(req.body.liked),
        improve: nullableText(req.body.improve),
      };
      const survey = oldSurvey
        ? await updateRow('academy_lesson_surveys', Number(oldSurvey.id), values)
        : await insertRow('academy_lesson_surveys', { studentId, lessonId, ...values });
      if (!survey) throw Object.assign(new Error('Failed to save lesson survey'), { statusCode: 500 });
      await recalculateStudentMetrics(studentId);

      let notification: { userId: number; taskId: number } | null = null;
      if (score < 3) {
        const leader = await queryOne<{ id: string }>(
          `SELECT u.id FROM users u WHERE ${leadershipUserAccessSql} AND u.is_active=true ORDER BY u.id LIMIT 1`,
        );
        const responsibleId = Number(student.managerId ?? leader?.id ?? req.user!.id);
        const taskResult = await createTaskOnce('Оценка урока ниже 3 — связаться с учеником', {
          responsibleId,
          description: `Ученик поставил ${score}/5. Свяжитесь и узнайте причину.`,
          entityType: 'lesson_survey',
          entityId: Number(survey.id),
          deadlineAt: addMinutes(new Date(), 12 * 60),
        });
        if (taskResult.created && student.managerId) {
          notification = { userId: Number(student.managerId), taskId: Number(taskResult.task.id) };
        }
      }
      return { survey, oldSurvey, created: !oldSurvey, notification };
    });

    if (result.notification) {
      await createNotification(
        result.notification.userId,
        'Низкая оценка урока',
        `Оценка ${score}/5 — задача закрывается за 12 часов.`,
        'academy_task',
        result.notification.taskId,
      );
    }
    await createAudit(
      req,
      result.created ? 'CREATE_ACADEMY_LESSON_SURVEY' : 'UPDATE_ACADEMY_LESSON_SURVEY',
      'academy_lesson_survey',
      Number(result.survey.id),
      result.survey,
      result.oldSurvey,
    );
    res.status(result.created ? 201 : 200).json(result.survey);
  } catch (error: any) {
    logger.error('Failed to save lesson survey', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to save lesson survey') });
  }
});

router.post('/surveys/parent', async (req, res) => {
  if (!ensureSalesAccess(req, res)) return;
  try {
    const studentId = parseId(req.body.studentId);
    if (!studentId) return res.status(400).json({ error: 'Student is required' });
    const rawNpsScore = req.body.npsScore;
    const npsScore = rawNpsScore === undefined || rawNpsScore === null || rawNpsScore === ''
      ? null
      : Number(rawNpsScore);
    if (npsScore !== null && (!Number.isInteger(npsScore) || npsScore < 0 || npsScore > 10)) {
      return res.status(400).json({ error: 'NPS score must be from 0 to 10' });
    }
    let period = nullableText(req.body.period);
    if (!period) {
      const periodRow = await queryOne<{ period: string }>(
        `SELECT to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS period`,
      );
      period = periodRow?.period;
    }
    if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ error: 'Invalid survey period' });
    }

    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`parent-survey:${studentId}:${period}`]);
      const student = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!student) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      if (
        !hasLeadershipAccess(req.user)
        && Number(student.managerId) !== Number(req.user!.id)
      ) {
        throw Object.assign(new Error('Sales employee can submit surveys only for own students'), { statusCode: 403 });
      }

      const oldSurvey = await queryOne(
        `SELECT *
         FROM academy_parent_surveys
         WHERE student_id = $1 AND period = $2
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [studentId, period],
      );
      const values = {
        groupId: student.groupId ?? null,
        courseId: student.courseId ?? null,
        progressAnswer: nullableText(req.body.progressAnswer),
        joyAnswer: nullableText(req.body.joyAnswer),
        continueAnswer: nullableText(req.body.continueAnswer),
        npsScore,
        comment: nullableText(req.body.comment),
        period,
      };
      const survey = oldSurvey
        ? await updateRow('academy_parent_surveys', Number(oldSurvey.id), values)
        : await insertRow('academy_parent_surveys', { studentId, ...values });
      if (!survey) throw Object.assign(new Error('Failed to save parent survey'), { statusCode: 500 });
      await updateRow('academy_students', studentId, { parentFeedback: values.comment });

      const notifications: Array<{ userId: number; taskId: number; title: string; message: string }> = [];
      const responsibleId = Number(student.managerId ?? req.user!.id);
      if (npsScore !== null && npsScore <= 6) {
        const leader = await queryOne<{ id: string }>(
          `SELECT u.id FROM users u WHERE ${leadershipUserAccessSql} AND u.is_active=true ORDER BY u.id LIMIT 1`,
        );
        const lowNpsTask = await createTaskOnce('Низкий NPS родителя — связаться с семьёй', {
          responsibleId: Number(student.managerId ?? leader?.id ?? req.user!.id),
          description: `Родитель поставил NPS ${npsScore}/10. Уточните причину и зафиксируйте решение.`,
          entityType: 'parent_survey',
          entityId: Number(survey.id),
          deadlineAt: addMinutes(new Date(), 12 * 60),
        });
        if (lowNpsTask.created && student.managerId) {
          notifications.push({
            userId: Number(student.managerId),
            taskId: Number(lowNpsTask.task.id),
            title: 'Низкий NPS родителя',
            message: 'Создана задача со сроком 12 часов.',
          });
        }
      }
      if (['Не уверен', 'Нет', 'not_sure', 'no'].includes(String(req.body.continueAnswer))) {
        await createTaskOnce('Родитель сомневается в продолжении', {
          responsibleId,
          description: 'Позвонить и узнать причину.',
          entityType: 'parent_survey',
          entityId: Number(survey.id),
          deadlineAt: addDays(new Date(), 1),
        });
      }
      return { survey, oldSurvey, created: !oldSurvey, notifications };
    });

    for (const notification of result.notifications) {
      await createNotification(
        notification.userId,
        notification.title,
        notification.message,
        'academy_task',
        notification.taskId,
      );
    }
    await createAudit(
      req,
      result.created ? 'CREATE_ACADEMY_PARENT_SURVEY' : 'UPDATE_ACADEMY_PARENT_SURVEY',
      'academy_parent_survey',
      Number(result.survey.id),
      result.survey,
      result.oldSurvey,
    );
    res.status(result.created ? 201 : 200).json(result.survey);
  } catch (error: any) {
    logger.error('Failed to save parent survey', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to save parent survey') });
  }
});

router.get('/integrations/status', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const logs = await query(
      `SELECT DISTINCT ON (provider) provider, direction, status, error_message, updated_at, created_at
       FROM academy_integration_logs
       ORDER BY provider, created_at DESC`,
      [],
    );
    const instagramAccounts = await query<{ id: number; username: string | null; lastError: string | null }>(
      `SELECT id, username, last_error
       FROM instagram_accounts
       WHERE status = 'connected'
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    );
    const instagramAccount = instagramAccounts[0] ?? null;
    const instagramRequiresReconnect = instagramAccount?.lastError === 'instagramReauthorizationRequired';
    const integ = appConfig.integrations ?? {};
    const hasSuccessfulInboundLog = (provider: string) =>
      logs.some((log) =>
        log.provider === provider
        && log.direction === 'inbound'
        && ['received', 'duplicate'].includes(String(log.status))
      );
    const providers = [
      {
        provider: 'instagram',
        connected: Boolean(instagramAccount) && !instagramRequiresReconnect,
        requiresReconnect: instagramRequiresReconnect,
        accountId: instagramAccount?.id ?? null,
        accountUsername: instagramAccount?.username ?? null,
        note: 'Instagram Login, Direct messages and automatic lead creation',
      },
      {
        provider: 'website',
        connected: Boolean(integ.website?.webhookSecret) || hasSuccessfulInboundLog('website'),
        requiresReconnect: false,
        accountId: null,
        accountUsername: null,
        note: 'Website lead inbound webhook',
      },
      {
        provider: 'onlinepbx',
        connected: onlinePbxClient.isConfigured(),
        requiresReconnect: false,
        accountId: null,
        accountUsername: onlinePbxClient.getDomain() || null,
        note: 'OnlinePBX click-to-call',
      },
    ];
    res.json(providers.map((entry) => ({
      provider: entry.provider,
      mode: entry.connected ? 'live' : 'stub',
      connected: entry.connected,
      accountId: entry.accountId,
      accountUsername: entry.accountUsername,
      lastLog: logs.find((log) => log.provider === entry.provider) ?? null,
      message: entry.requiresReconnect
        ? 'Токен Instagram недействителен. Подключите аккаунт заново — после этого CRM автоматически восстановит имена и username лидов.'
        : entry.connected
        ? `${entry.note}: подключено.`
        : `${entry.note}: режим-заглушка. Заполните ключи в config/app.config.json.`,
    })));
  } catch (error) {
    logger.error('Failed to fetch integrations status', { error });
    res.status(500).json({ error: 'Failed to fetch integrations status' });
  }
});

router.post('/integrations/:provider/test', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const provider = String(req.params.provider);
    // Actually exercise the channel so the test reflects real connectivity.
    if (provider === 'telegram') {
      const { sendTelegramMessage } = await import('../../services/telegram');
      const recipient = nullableText(req.body.recipient) ?? appConfig.integrations?.telegram?.leadershipChatId ?? 'leadership';
      const result = await sendTelegramMessage(recipient, '01 Academy: тест интеграции Telegram ✅');
      const log = await logIntegration('telegram', 'outbound', result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed', { result }, result.error ?? null);
      return res.json({ ok: result.ok, simulated: result.simulated, error: result.error, log });
    }
    if (provider === 'whatsapp') {
      const { sendWhatsAppMessage } = await import('../../services/whatsapp');
      const recipient = nullableText(req.body.recipient) ?? '+998901234567';
      const result = await sendWhatsAppMessage(recipient, '01 Academy: тест интеграции WhatsApp ✅');
      const log = await logIntegration('whatsapp', 'outbound', result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed', { result }, result.error ?? null);
      return res.json({ ok: result.ok, simulated: result.simulated, error: result.error, log });
    }
    if (provider === 'onlinepbx') {
      const extensions = await onlinePbxClient.listExtensions();
      const log = await logIntegration('onlinepbx', 'outbound', 'connected', {
        domain: onlinePbxClient.getDomain(),
        extensionCount: extensions.length,
      });
      return res.json({
        ok: true,
        domain: onlinePbxClient.getDomain(),
        extensions,
        log,
      });
    }
    const log = await logIntegration(provider, 'outbound', 'stub_sent', req.body ?? {});
    res.json({ ok: true, mode: 'safe_stub', log });
  } catch (error) {
    logger.error('Failed to test integration', { error });
    if (error instanceof OnlinePbxError) {
      await logIntegration('onlinepbx', 'outbound', 'failed', {}, error.clientCode).catch(() => undefined);
      return res.status(error.statusCode).json({ error: error.clientCode });
    }
    res.status(500).json({ error: 'Failed to test integration' });
  }
});

router.post('/automations/run', async (req, res) => {
  if (!ensureModuleAccess(req, res, OPERATIONS_MODULES, 'Operations access required')) return;
  try {
    // Manual and scheduled runs must share the same locking/idempotency rules.
    // Keeping a second implementation here previously produced duplicate tasks
    // and mailings that the scheduled worker correctly avoided.
    const actions = await runAutomations(req.user!.id);
    res.json({ ok: true, actions });
  } catch (error) {
    logger.error('Failed to run academy automations', { error });
    res.status(500).json({ error: 'Failed to run academy automations' });
  }
});

router.post('/mailings/:id/event', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid mailing id' });
    const outbox = await queryOne(`SELECT * FROM academy_notification_outbox WHERE id = $1`, [id]);
    if (!outbox) return res.status(404).json({ error: 'Mailing not found' });

    const eventType = nullableText(req.body.eventType) ?? 'opened';
    await logIntegration(`mailing_${outbox.channel}`, 'inbound', eventType, {
      outboxId: id,
      entityType: outbox.entityType,
      entityId: outbox.entityId,
      payload: req.body });

    if (eventType === 'reply' && outbox.entityType === 'lead' && outbox.entityId) {
      const lead = await getLead(Number(outbox.entityId));
      if (lead?.statusCode === 'not_now' && !lead.isArchived) {
        const updated = await updateRow('academy_leads', lead.id, {
          statusCode: 'first_contact',
          warmReason: null });
        await createStageHistory(lead.id, 'not_now', 'first_contact', req.user!.id, 'Отклик на рассылку');
        await createTask('Лид откликнулся из тёплой базы', {
          responsibleId: updated?.managerId ?? req.user!.id,
          entityType: 'lead',
          entityId: lead.id,
          deadlineAt: addDays(new Date(), 1) });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Failed to record mailing event', { error });
    res.status(500).json({ error: 'Failed to record mailing event' });
  }
});

router.all(
  [
    '/finance',
    '/payroll',
    '/payroll/*',
    '/exports/:entity',
    '/groups/profitability',
  ],
  (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  },
);

const parseCourseWithTeachersPayload = (body: Row) => {
  const name = nullableText(body.name);
  const slug = nullableText(body.slug);
  const ageCategory = nullableText(body.ageCategory);
  const description = nullableText(body.description) ?? null;
  const basePriceUzs = Number(body.basePriceUzs);
  if (!name || name.length > 255) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!slug || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!ageCategory || ageCategory.length > 100) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!Number.isSafeInteger(basePriceUzs) || basePriceUzs < 0 || basePriceUzs > 2_147_483_647) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (typeof body.isActive !== 'boolean') {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (body.teacherIds !== undefined && (!Array.isArray(body.teacherIds) || body.teacherIds.length > 1_000)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  const parsedTeacherIds = Array.isArray(body.teacherIds) ? body.teacherIds.map(parseId) : [];
  if (parsedTeacherIds.some((id) => !id)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  const teacherIds = [...new Set(parsedTeacherIds as number[])].sort((left, right) => left - right);
  return {
    courseValues: { name, slug, ageCategory, description, basePriceUzs, isActive: body.isActive },
    teacherIds: body.teacherIds === undefined ? null : teacherIds,
  };
};

const readTeacherCourseIds = (value: unknown): number[] => {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))]
    .sort((left, right) => left - right);
};

const syncCourseTeacherAssignments = async (courseId: number, selectedTeacherIds: number[]) => {
  // Keep course capabilities in sync with live teaching obligations. The same
  // scheduling lock is used by group/lesson mutations, so a new obligation
  // cannot appear between this dependency check and the teacher updates.
  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
  const requiredAssignments = await query<{ teacherId: number }>(
    `SELECT DISTINCT assignment.teacher_id
     FROM (
       SELECT teacher_id
       FROM academy_groups
       WHERE course_id = $1
         AND status IN ('open', 'in_progress')
         AND teacher_id IS NOT NULL
       UNION
       SELECT teacher_id
       FROM academy_lessons
       WHERE course_id = $1
         AND status = 'scheduled'
         AND teacher_id IS NOT NULL
     ) assignment
     ORDER BY assignment.teacher_id`,
    [courseId],
  );
  const teachers = await query(
    `SELECT * FROM academy_teachers ORDER BY id FOR UPDATE`,
  );
  const teacherIds = new Set(teachers.map((teacher) => Number(teacher.id)));
  if (selectedTeacherIds.some((teacherId) => !teacherIds.has(teacherId))) {
    throw Object.assign(new Error('One or more teachers were not found'), { statusCode: 400 });
  }
  const selected = new Set(selectedTeacherIds);
  const required = new Set(requiredAssignments.map((assignment) => Number(assignment.teacherId)));
  for (const teacher of teachers) {
    const previousIds = readTeacherCourseIds(teacher.courseIds);
    const nextIds = previousIds.filter((id) => id !== courseId);
    if (selected.has(Number(teacher.id)) || required.has(Number(teacher.id))) nextIds.push(courseId);
    nextIds.sort((left, right) => left - right);
    if (
      previousIds.length !== nextIds.length
      || previousIds.some((id, index) => id !== nextIds[index])
    ) {
      await updateRow('academy_teachers', Number(teacher.id), { courseIds: nextIds });
    }
  }
};

const saveCourseWithTeachers = async (req: any, courseId?: number) => {
  const { courseValues, teacherIds } = parseCourseWithTeachersPayload(req.body ?? {});
  return withTransaction(async () => {
    const oldCourse = courseId
      ? await queryOne(`SELECT * FROM academy_courses WHERE id = $1 FOR UPDATE`, [courseId])
      : null;
    if (courseId && !oldCourse) {
      throw Object.assign(new Error('courses not found'), { statusCode: 404 });
    }
    if (courseId && oldCourse?.isActive !== false && courseValues.isActive === false) {
      const activeGroup = await queryOne(
        `SELECT id
         FROM academy_groups
         WHERE course_id = $1 AND status IN ('open', 'in_progress')
         LIMIT 1
         FOR SHARE`,
        [courseId],
      );
      if (activeGroup) {
        throw Object.assign(new Error('courseHasActiveGroups'), { statusCode: 409 });
      }
    }
    const course = courseId
      ? await updateRow('academy_courses', courseId, courseValues)
      : await insertRow('academy_courses', courseValues);
    if (!course) throw Object.assign(new Error('Failed to save courses'), { statusCode: 500 });
    if (teacherIds) await syncCourseTeacherAssignments(Number(course.id), teacherIds);
    return { course, oldCourse };
  });
};

router.post('/courses/with-teachers', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const result = await saveCourseWithTeachers(req);
    await createAudit(req, 'CREATE_ACADEMY_COURSE_WITH_TEACHERS', 'academy_course', Number(result.course.id), result.course);
    res.status(201).json(result.course);
  } catch (error: any) {
    logger.error('Failed to create course with teacher assignments', { error });
    const duplicateSlug = error?.code === '23505' && String(error?.constraint ?? '').includes('academy_courses_slug');
    res.status(duplicateSlug ? 409 : error.statusCode || 500).json({
      error: duplicateSlug ? 'courseSlugAlreadyExists' : getPublicErrorMessage(error, 'Failed to create courses'),
    });
  }
});

router.patch('/courses/:id/with-teachers', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  const courseId = parseId(req.params.id);
  if (!courseId) return res.status(400).json({ error: 'Invalid courses id' });
  try {
    const result = await saveCourseWithTeachers(req, courseId);
    await createAudit(
      req,
      'UPDATE_ACADEMY_COURSE_WITH_TEACHERS',
      'academy_course',
      courseId,
      result.course,
      result.oldCourse,
    );
    res.json(result.course);
  } catch (error: any) {
    logger.error('Failed to update course with teacher assignments', { error, courseId });
    const duplicateSlug = error?.code === '23505' && String(error?.constraint ?? '').includes('academy_courses_slug');
    res.status(duplicateSlug ? 409 : error.statusCode || 500).json({
      error: duplicateSlug ? 'courseSlugAlreadyExists' : getPublicErrorMessage(error, 'Failed to update courses'),
    });
  }
});

router.delete('/courses/:id', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  const courseId = parseId(req.params.id);
  if (!courseId) return res.status(400).json({ error: 'Invalid courses id' });
  try {
    const oldCourse = await withTransaction(async () => {
      const course = await queryOne(`SELECT * FROM academy_courses WHERE id = $1 FOR UPDATE`, [courseId]);
      if (!course) throw Object.assign(new Error('courses not found'), { statusCode: 404 });
      await syncCourseTeacherAssignments(courseId, []);
      await query(`DELETE FROM academy_courses WHERE id = $1`, [courseId]);
      return course;
    });
    await createAudit(req, 'DELETE_ACADEMY_COURSE', 'academy_course', courseId, undefined, oldCourse);
    res.json({ ok: true });
  } catch (error: any) {
    logger.error('Failed to delete course', { error, courseId });
    const isForeignKeyConflict = error?.code === '23503';
    res.status(error.statusCode || (isForeignKeyConflict ? 409 : 500)).json({
      error: isForeignKeyConflict ? 'resourceInUse' : getPublicErrorMessage(error, 'Failed to delete courses'),
    });
  }
});

router.put('/pipeline-statuses/reorder', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    if (!Array.isArray(req.body.orderedStatusIds) || req.body.orderedStatusIds.length === 0) {
      return res.status(400).json({ error: 'invalidData' });
    }
    const parsedIds = req.body.orderedStatusIds.map(parseId);
    if (parsedIds.some((id: number | null) => !id) || new Set(parsedIds).size !== parsedIds.length) {
      return res.status(400).json({ error: 'invalidData' });
    }
    const orderedStatusIds = parsedIds as number[];
    const statuses = await withTransaction(async () => {
      const locked = await query(
        `SELECT * FROM academy_lead_statuses ORDER BY id FOR UPDATE`,
      );
      const actualIds = new Set(locked.map((status) => Number(status.id)));
      if (
        actualIds.size !== orderedStatusIds.length
        || orderedStatusIds.some((statusId) => !actualIds.has(statusId))
      ) {
        throw Object.assign(new Error('pipelineConfigurationChanged'), { statusCode: 409 });
      }
      await query(
        `UPDATE academy_lead_statuses AS status
         SET sort_order = (ordered.position * 10)::int,
             updated_at = NOW()
         FROM UNNEST($1::int[]) WITH ORDINALITY AS ordered(id, position)
         WHERE status.id = ordered.id`,
        [orderedStatusIds],
      );
      return query(`SELECT * FROM academy_lead_statuses ORDER BY sort_order, id`);
    });
    await createAudit(req, 'REORDER_ACADEMY_LEAD_STATUSES', 'academy_lead_statuses', 0, {
      orderedStatusIds,
    });
    res.json(statuses);
  } catch (error: any) {
    logger.error('Failed to reorder pipeline statuses', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to reorder pipeline statuses') });
  }
});

router.get('/pipeline-statuses/:id/usage', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid pipeline stage id' });

    const status = await queryOne(
      `SELECT id, code, name
       FROM academy_lead_statuses
       WHERE id = $1`,
      [id],
    );
    if (!status) return res.status(404).json({ error: 'pipeline-statuses not found' });

    res.json({
      id: Number(status.id),
      code: status.code,
      name: status.name,
      leadCount: await getLeadCountForStatusCode(String(status.code)),
    });
  } catch (error) {
    logger.error('Failed to fetch pipeline stage usage', { error, statusId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch pipeline stage usage' });
  }
});

router.post('/pipeline-statuses/:id/transfer-leads-and-delete', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    const targetStatusId = parseId(req.body.targetStatusId);
    if (!id) return res.status(400).json({ error: 'Invalid pipeline stage id' });
    if (!targetStatusId) return res.status(400).json({ error: 'targetPipelineStageRequired' });
    if (Number(targetStatusId) === Number(id)) {
      return res.status(400).json({ error: 'targetPipelineStageMustDiffer' });
    }

    const result = await withTransaction(async () => {
      const lockedStatuses = await query(
        `SELECT *
         FROM academy_lead_statuses
         WHERE id = ANY($1::int[])
         ORDER BY id
         FOR UPDATE`,
        [[id, targetStatusId]],
      );
      const source = lockedStatuses.find((status) => Number(status.id) === Number(id));
      if (!source) {
        throw Object.assign(new Error('pipeline-statuses not found'), { statusCode: 404 });
      }
      if (source.isPipeline !== true) {
        throw Object.assign(new Error('sourcePipelineStageRequired'), { statusCode: 400 });
      }
      if (source.isSystem === true) {
        throw Object.assign(new Error('systemPipelineStageCannotBeDeleted'), { statusCode: 409 });
      }

      const target = lockedStatuses.find(
        (status) => Number(status.id) === Number(targetStatusId),
      );
      if (!target) {
        throw Object.assign(new Error('targetPipelineStageRequired'), { statusCode: 400 });
      }
      if (target.isActive === false) {
        throw Object.assign(new Error('targetPipelineStageMustBeActive'), { statusCode: 400 });
      }
      if (target.isPipeline !== true) {
        throw Object.assign(new Error('targetPipelineStageRequired'), { statusCode: 400 });
      }
      const transitionError = validateLeadStatusTransition(String(source.code), String(target.code));
      if (transitionError) {
        throw Object.assign(new Error(transitionError), { statusCode: 409 });
      }

      const leads = await query<Row>(
        `SELECT *
         FROM academy_leads
         WHERE status_code = $1
         ORDER BY id
         FOR UPDATE`,
        [source.code],
      );
      const leadIds = leads.map((lead) => Number(lead.id));

      for (const lead of leads) {
        const validationError = validateLeadForStatusChange({
          nextStatus: String(target.code),
          studentName: lead.studentName,
          studentAge: lead.studentAge,
          courseId: lead.courseId,
          enrolledGroupId: lead.enrolledGroupId,
        });
        if (validationError) {
          throw Object.assign(new Error(validationError), {
            statusCode: 409,
            leadId: lead.id,
          });
        }
      }

      const enrollmentGroupIds = [...new Set(
        leads
          .filter(() => ['enrolled', 'paid'].includes(String(target.code)))
          .map((lead) => Number(lead.enrolledGroupId))
          .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
      )].sort((left, right) => left - right);
      for (const groupId of enrollmentGroupIds) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
        const leadsInGroup = leads.filter(
          (lead) => Number(lead.enrolledGroupId) === Number(groupId),
        );
        for (const lead of leadsInGroup) {
          await validateEnrollmentGroup(groupId, Number(lead.id));
        }
      }

      if (leadIds.length > 0) {
        await query(
          `INSERT INTO academy_lead_stage_history
            (lead_id, from_status_code, to_status_code, changed_by, comment)
           SELECT id, $1, $2, $3, $4
           FROM academy_leads
           WHERE id = ANY($5::int[])`,
          [
            source.code,
            target.code,
            req.user!.id,
            'Массовый перенос перед удалением этапа воронки',
            leadIds,
          ],
        );

        await query(
          `UPDATE academy_leads
           SET status_code = $1,
               updated_at = NOW()
           WHERE id = ANY($2::int[])`,
          [target.code, leadIds],
        );
        for (const lead of leads) {
          await handleLeadStatusEffects(
            req,
            { ...lead, statusCode: target.code },
            String(source.code),
          );
        }
      }

      await query(`DELETE FROM academy_lead_statuses WHERE id = $1`, [id]);

      return {
        deletedStatus: source,
        targetStatus: target,
        movedCount: leadIds.length,
      };
    });

    await createAudit(
      req,
      'DELETE_ACADEMY_LEAD_STATUS_WITH_TRANSFER',
      'academy_lead_statuses',
      id,
      {
        targetStatusId: result.targetStatus.id,
        targetStatusCode: result.targetStatus.code,
        movedCount: result.movedCount,
      },
      result.deletedStatus,
    );

    res.json({
      ok: true,
      movedCount: result.movedCount,
      targetStatus: result.targetStatus,
    });
  } catch (error: any) {
    logger.error('Failed to transfer leads and delete pipeline stage', { error, statusId: req.params.id });
    res.status(error.statusCode || 500).json({
      error: getPublicErrorMessage(error, 'Failed to transfer leads and delete pipeline stage'),
    });
  }
});
};
