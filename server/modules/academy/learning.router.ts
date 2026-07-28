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
  canAccessAcademyWorkspace,
  getAssignedWorkspaces,
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
  LEAD_WORKSPACES,
  OPERATIONS_WORKSPACES,
  Row,
  createAudit,
  createNotification,
  createOutbox,
  createTask,
  ensureLeadMutationAccess,
  ensureOperationsAccess,
  ensureWorkspaceAccess,
  insertRow,
  nullableText,
  parseId,
  parseOptionalDate,
  query,
  queryOne,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  getLead,
  recalculateStudentMetrics,
  validateEnrollmentGroup,
} from './academy-leads';
import {
  resolveTeacherId,
} from './academy-analytics';
import {
  getLessonRoster,
  prepareLessonMutation,
} from './academy-route-support';

export const registerAcademyLearningRoutes = (router: ReturnType<typeof Router>) => {
router.get('/lessons/:id/attendance-roster', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    const lesson = await queryOne(
      `SELECT lesson.*, teacher.user_id AS teacher_user_id
       FROM academy_lessons lesson
       LEFT JOIN academy_teachers teacher
         ON teacher.id = lesson.teacher_id AND teacher.status = 'active'
       WHERE lesson.id = $1`,
      [lessonId],
    );
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    if (
      getAssignedWorkspaces(req.user).includes('teacher')
      && !hasLeadershipAccess(req.user)
      && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== Number(req.user!.id))
    ) {
      return res.status(403).json({ error: 'teacherOwnLessonRosterOnly' });
    }
    const [students, attendance] = await Promise.all([
      getLessonRoster(Number(lesson.groupId), lesson.scheduledAt),
      query(`SELECT * FROM academy_attendance WHERE lesson_id = $1 ORDER BY student_id`, [lessonId]),
    ]);
    res.json({ lesson, students, attendance });
  } catch (error: any) {
    logger.error('Failed to load lesson attendance roster', { error, lessonId: req.params.id });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to load attendance roster') });
  }
});

router.post('/lessons/:id/reschedule', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    const nextScheduledAt = parseOptionalDate(req.body.scheduledAt, 'scheduledAt');
    if (!(nextScheduledAt instanceof Date)) {
      return res.status(400).json({ error: 'rescheduleDateRequired' });
    }
    if (nextScheduledAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'rescheduleDateMustBeFuture' });
    }
    const reason = nullableText(req.body.reason);
    if (!reason || reason.length > 500) {
      return res.status(400).json({ error: 'rescheduleReasonRequired' });
    }
    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
      const lesson = await queryOne(
        `SELECT lesson.*, teacher.user_id AS teacher_user_id
         FROM academy_lessons lesson
         LEFT JOIN academy_teachers teacher
           ON teacher.id = lesson.teacher_id AND teacher.status = 'active'
         WHERE lesson.id = $1
         FOR UPDATE OF lesson`,
        [lessonId],
      );
      if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      if (!['scheduled', 'conducted'].includes(String(lesson.status))) {
        throw Object.assign(new Error('onlyReschedulableLessonCanBeRescheduled'), { statusCode: 409 });
      }
      if (
        getAssignedWorkspaces(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('teacherOwnLessonRescheduleOnly'), { statusCode: 403 });
      }
      const previousScheduledAt = new Date(lesson.scheduledAt);
      if (nextScheduledAt.getTime() === previousScheduledAt.getTime()) {
        throw Object.assign(new Error('rescheduleDateMustChange'), { statusCode: 400 });
      }
      const deltaMs = nextScheduledAt.getTime() - previousScheduledAt.getTime();
      const affected = await query(
        `SELECT affected_lesson.*, affected_teacher.user_id AS teacher_user_id
         FROM academy_lessons affected_lesson
         LEFT JOIN academy_teachers affected_teacher
           ON affected_teacher.id = affected_lesson.teacher_id
         WHERE affected_lesson.group_id = $1
           AND (
             affected_lesson.id = $3
             OR (
               affected_lesson.status = 'scheduled'
               AND affected_lesson.scheduled_at > $2
             )
           )
         ORDER BY affected_lesson.scheduled_at, affected_lesson.id
         FOR UPDATE OF affected_lesson`,
        [lesson.groupId, previousScheduledAt, lessonId],
      );
      if (!affected.some((item) => Number(item.id) === lessonId)) {
        throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      }
      if (
        getAssignedWorkspaces(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && affected.some((item) => Number(item.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('teacherOwnLessonRescheduleOnly'), { statusCode: 403 });
      }
      const affectedLessonIds = affected.map((item) => Number(item.id));
      const lessonWithAttendance = await queryOne(
        `SELECT lesson_id
         FROM academy_attendance
         WHERE lesson_id = ANY($1::int[])
           AND ($2::integer IS NULL OR lesson_id <> $2)
         LIMIT 1`,
        [affectedLessonIds, lesson.status === 'conducted' ? lessonId : null],
      );
      if (lessonWithAttendance) {
        throw Object.assign(new Error('lessonWithAttendanceCannotBeRescheduled'), { statusCode: 409 });
      }

      const reopenedStudentRows = lesson.status === 'conducted'
        ? await query<{ studentId: number }>(
          `DELETE FROM academy_attendance
           WHERE lesson_id = $1
           RETURNING student_id`,
          [lessonId],
        )
        : [];

      const updateOrder = deltaMs > 0 ? [...affected].reverse() : affected;
      const updatedLessons: Row[] = [];
      for (const affectedLesson of updateOrder) {
        const oldDate = new Date(affectedLesson.scheduledAt);
        const newDate = new Date(oldDate.getTime() + deltaMs);
        if (newDate.getTime() <= Date.now()) {
          throw Object.assign(new Error('rescheduleDateMustBeFuture'), { statusCode: 400 });
        }
        const reopensConductedLesson = Number(affectedLesson.id) === lessonId && lesson.status === 'conducted';
        const values: Row = {
          scheduledAt: newDate,
          ...(reopensConductedLesson ? { status: 'scheduled' } : {}),
        };
        await prepareLessonMutation({
          values,
          oldRow: affectedLesson,
          excludeLessonId: Number(affectedLesson.id),
          forceAutoAssign: false,
        });
        const updated = await updateRow('academy_lessons', Number(affectedLesson.id), values);
        if (!updated) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
        await insertRow('academy_lesson_reschedules', {
          lessonId: Number(affectedLesson.id),
          previousScheduledAt: oldDate,
          nextScheduledAt: newDate,
          reason,
          changedBy: req.user!.id,
        });
        if (reopensConductedLesson) {
          await insertRow('academy_lesson_status_history', {
            lessonId,
            fromStatus: 'conducted',
            toStatus: 'scheduled',
            changedBy: req.user!.id,
            comment: reason,
          });
        }
        updatedLessons.push(updated);
      }

      for (const studentId of new Set(reopenedStudentRows.map((row) => Number(row.studentId)))) {
        await recalculateStudentMetrics(studentId);
      }

      await query(
        `UPDATE academy_groups academy_group
         SET end_date = (
               SELECT MAX(group_lesson.scheduled_at)
               FROM academy_lessons group_lesson
               WHERE group_lesson.group_id = academy_group.id
                 AND group_lesson.status <> 'cancelled'
             ),
             updated_at = NOW()
         WHERE academy_group.id = $1`,
        [lesson.groupId],
      );
      updatedLessons.sort((left, right) => (
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      ));
      return {
        previousLesson: lesson,
        lesson: updatedLessons.find((item) => Number(item.id) === lessonId),
        lessons: updatedLessons,
      };
    });

    await createAudit(
      req,
      'RESCHEDULE_ACADEMY_LESSON',
      'academy_lesson',
      lessonId,
      { lesson: result.lesson, shiftedLessonIds: result.lessons.map((lesson) => lesson.id), reason },
      result.previousLesson,
    );
    res.json({
      lesson: result.lesson,
      lessons: result.lessons,
      shiftedCount: result.lessons.length,
    });
  } catch (error: any) {
    logger.error('Failed to reschedule lesson', { error, lessonId: req.params.id });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to reschedule lesson') });
  }
});

router.post('/lessons/:id/attendance', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    if (!Array.isArray(req.body.attendance)) {
      return res.status(400).json({ error: 'Invalid attendance payload' });
    }
    const requestedLessonStatus = nullableText(req.body.lessonStatus) ?? 'conducted';
    if (!['scheduled', 'conducted'].includes(String(requestedLessonStatus))) {
      return res.status(400).json({ error: 'Invalid lesson status' });
    }

    const normalizedItems: Array<Row & {
      studentId: number;
      status: 'present' | 'absent';
      hasProjectUrl: boolean;
      hasNote: boolean;
    }> = [];
    const seenStudentIds = new Set<number>();
    for (const item of req.body.attendance) {
      const studentId = parseId(item?.studentId);
      if (!studentId || !['present', 'absent'].includes(String(item?.status))) {
        return res.status(400).json({ error: 'Invalid attendance item' });
      }
      if (seenStudentIds.has(studentId)) {
        return res.status(400).json({ error: 'Duplicate attendance student' });
      }
      seenStudentIds.add(studentId);
      normalizedItems.push({
        ...item,
        studentId,
        status: item.status,
        hasProjectUrl: Object.prototype.hasOwnProperty.call(item, 'projectUrl'),
        hasNote: Object.prototype.hasOwnProperty.call(item, 'note'),
      });
    }

    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
      const lesson = await queryOne(
        `SELECT l.*, t.user_id AS teacher_user_id
         FROM academy_lessons l
         LEFT JOIN academy_teachers t ON t.id = l.teacher_id AND t.status = 'active'
         WHERE l.id = $1
         FOR UPDATE OF l`,
        [lessonId],
      );
      if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      if (lesson.status === 'cancelled') {
        throw Object.assign(new Error('cancelledLessonAttendanceNotAllowed'), { statusCode: 400 });
      }
      if (
        getAssignedWorkspaces(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== req.user!.id)
      ) {
        throw Object.assign(new Error('teacherOwnLessonAttendanceOnly'), { statusCode: 403 });
      }
      if (lesson.status === 'conducted' && requestedLessonStatus === 'scheduled') {
        throw Object.assign(new Error('conductedLessonCannotBeReopened'), { statusCode: 409 });
      }
      if (requestedLessonStatus === 'scheduled') {
        throw Object.assign(new Error('attendanceDraftNotSupported'), { statusCode: 400 });
      }
      if (
        requestedLessonStatus === 'conducted'
        && lesson.status !== 'conducted'
        && new Date(lesson.scheduledAt).getTime() > Date.now()
      ) {
        throw Object.assign(new Error('lessonNotStarted'), { statusCode: 409 });
      }
      if (requestedLessonStatus === 'conducted' && lesson.status !== 'conducted') {
        const previousIncompleteLesson = await queryOne(
          `SELECT previous_lesson.id
           FROM academy_lessons previous_lesson
           WHERE previous_lesson.group_id = $1
             AND previous_lesson.status = 'scheduled'
             AND previous_lesson.scheduled_at < $2
           ORDER BY previous_lesson.scheduled_at, previous_lesson.id
           LIMIT 1
           FOR UPDATE`,
          [lesson.groupId, lesson.scheduledAt],
        );
        if (previousIncompleteLesson) {
          throw Object.assign(new Error('previousLessonMustBeCompleted'), { statusCode: 409 });
        }
      }

      const groupStudents = await getLessonRoster(
        Number(lesson.groupId),
        lesson.scheduledAt,
        true,
      );
      if (groupStudents.length > 0 && normalizedItems.length === 0) {
        throw Object.assign(new Error('attendanceRequired'), { statusCode: 400 });
      }
      const studentsById = new Map(groupStudents.map((student) => [Number(student.id), student]));
      if (normalizedItems.some((item) => !studentsById.has(item.studentId))) {
        throw Object.assign(
          new Error('attendanceStudentsOutsideLesson'),
          { statusCode: 403 },
        );
      }
      if (
        requestedLessonStatus === 'conducted'
        && normalizedItems.length !== groupStudents.length
      ) {
        throw Object.assign(new Error('attendanceIncomplete'), { statusCode: 409 });
      }

      const saved: Row[] = [];
      for (const item of normalizedItems) {
        const rows = await query(
          `INSERT INTO academy_attendance (lesson_id, student_id, status, project_url, note, marked_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (lesson_id, student_id)
           DO UPDATE SET
             status = EXCLUDED.status,
             project_url = CASE
               WHEN $7::boolean THEN EXCLUDED.project_url
               ELSE academy_attendance.project_url
             END,
             note = CASE
               WHEN $8::boolean THEN EXCLUDED.note
               ELSE academy_attendance.note
             END,
             marked_by = EXCLUDED.marked_by,
             updated_at = NOW()
           RETURNING *`,
          [
            lessonId,
            item.studentId,
            item.status,
            nullableText(item.projectUrl) ?? null,
            nullableText(item.note) ?? null,
            req.user!.id,
            item.hasProjectUrl,
            item.hasNote,
          ],
        );
        saved.push(rows[0]);
      }

      const updatedLesson = await updateRow('academy_lessons', lessonId, {
        status: requestedLessonStatus,
      });
      if (lesson.status !== updatedLesson?.status) {
        await insertRow('academy_lesson_status_history', {
          lessonId,
          fromStatus: lesson.status ?? null,
          toStatus: updatedLesson?.status ?? requestedLessonStatus,
          changedBy: req.user!.id,
          comment: nullableText(req.body.statusComment) ?? 'Статус изменён при сохранении посещаемости',
        });
      }
      const absenceAlerts: Row[] = [];
      if (requestedLessonStatus === 'conducted') {
        for (const item of normalizedItems) {
          const recentAttendance = await query<{ status: string }>(
            `SELECT a.status
             FROM academy_lessons l
             JOIN academy_attendance a ON a.lesson_id = l.id AND a.student_id = $2
             WHERE l.group_id = $1
               AND l.status = 'conducted'
               AND l.scheduled_at >= COALESCE(
                 (
                   SELECT MAX(membership.enrolled_at)
                   FROM academy_student_group_enrollments membership
                   WHERE membership.student_id = $2
                     AND membership.group_id = $1
                     AND membership.enrolled_at <= l.scheduled_at
                 ),
                 (
                   SELECT MAX(transfer.created_at)
                   FROM academy_student_transfers transfer
                   WHERE transfer.student_id = $2 AND transfer.to_group_id = $1
                 ),
                 (
                   SELECT COALESCE(student.enrolled_at, student.created_at)
                   FROM academy_students student
                   WHERE student.id = $2
                 )
               )
             ORDER BY l.scheduled_at DESC
             LIMIT 3`,
            [lesson.groupId, item.studentId],
          );
          const existingTask = await queryOne(
            `SELECT id
             FROM academy_tasks
             WHERE entity_type = 'student'
               AND entity_id = $1
               AND title = '3 пропуска подряд: позвонить родителю'
               AND status <> 'done'
             LIMIT 1`,
            [item.studentId],
          );
          const hasConsecutiveAbsenceRisk = recentAttendance.length === 3
            && recentAttendance.every((row) => row.status === 'absent');
          if (!hasConsecutiveAbsenceRisk) {
            if (existingTask) {
              await query(
                `UPDATE academy_tasks
                 SET status = 'done',
                     completed_at = COALESCE(completed_at, NOW()),
                     updated_at = NOW()
                 WHERE id = $1 AND status <> 'done'`,
                [existingTask.id],
              );
            }
            continue;
          }
          if (existingTask) continue;
          const student = studentsById.get(item.studentId)!;
          await createTask('3 пропуска подряд: позвонить родителю', {
            responsibleId: student.managerId ?? req.user!.id,
            entityType: 'student',
            entityId: item.studentId,
            deadlineAt: addDays(new Date(), 1),
          });
          absenceAlerts.push(student);
        }
      }

      for (const student of groupStudents) {
        await recalculateStudentMetrics(Number(student.id));
      }

      if (lesson.status !== 'conducted' && updatedLesson?.status === 'conducted') {
        const presentStudentIds = new Set(
          normalizedItems
            .filter((item) => item.status === 'present')
            .map((item) => item.studentId),
        );
        for (const student of groupStudents) {
          if (!presentStudentIds.has(Number(student.id))) continue;
          await createOutbox(
            'whatsapp',
            student.phone,
            'Оцените сегодняшний урок 01 Academy: /survey',
            {
              scheduledAt: addMinutes(
                new Date(lesson.scheduledAt),
                Number(lesson.durationMinutes || 120) + 30,
              ),
              entityType: 'lesson',
              entityId: lessonId,
            },
          );
        }
      }
      return { lesson: updatedLesson, attendance: saved, absenceAlerts };
    });

    for (const student of result.absenceAlerts) {
      await createNotification(
        student.managerId ?? req.user!.id,
        'Риск по посещаемости',
        `${student.studentName ?? 'Ученик'} пропустил 3 занятия подряд`,
        'student',
        Number(student.id),
      );
    }
    res.json({ lesson: result.lesson, attendance: result.attendance });
  } catch (error: any) {
    logger.error('Failed to save attendance', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to save attendance') });
  }
});

router.post('/students/:id/transfer', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, OPERATIONS_WORKSPACES, 'Operations access required')) return;
  try {
    const studentId = parseId(req.params.id);
    const toGroupId = parseId(req.body.toGroupId);
    if (!studentId || !toGroupId) return res.status(400).json({ error: 'Student and target group are required' });
    const initialStudent = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!initialStudent) return res.status(404).json({ error: 'Student not found' });

    const student = await withTransaction(async () => {
      // Payments lock lead -> student -> group. Keep the same order here to
      // avoid deadlocks between a payment and a simultaneous transfer.
      if (initialStudent.leadId) {
        await queryOne(`SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE`, [initialStudent.leadId]);
      }
      const lockedStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!lockedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (Number(lockedStudent.groupId) === Number(toGroupId)) return lockedStudent;

      await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [toGroupId]);
      const targetGroup = await validateEnrollmentGroup(toGroupId, null, studentId);
      if (!targetGroup) {
        throw Object.assign(new Error('Group not found'), { statusCode: 404 });
      }

      if (lockedStudent.groupId) {
        await query(
          `INSERT INTO academy_student_group_enrollments
             (student_id, group_id, status, is_primary, enrolled_at, created_by)
           VALUES ($1, $2, 'active', false, COALESCE($3, NOW()), $4)
           ON CONFLICT (student_id, group_id) WHERE status = 'active' DO NOTHING`,
          [
            studentId,
            Number(lockedStudent.groupId),
            lockedStudent.enrolledAt ?? lockedStudent.enrollmentDate ?? lockedStudent.createdAt ?? new Date(),
            req.user!.id,
          ],
        );
      }
      await query(
        `UPDATE academy_student_group_enrollments
         SET is_primary = false, updated_at = NOW()
         WHERE student_id = $1 AND status = 'active' AND is_primary = true`,
        [studentId],
      );
      if (lockedStudent.groupId) {
        await query(
          `UPDATE academy_student_group_enrollments
           SET status = 'withdrawn', is_primary = false, ended_at = NOW(), updated_at = NOW()
           WHERE student_id = $1 AND group_id = $2 AND status = 'active'`,
          [studentId, Number(lockedStudent.groupId)],
        );
      }
      await query(
        `INSERT INTO academy_student_group_enrollments
           (student_id, group_id, status, is_primary, enrolled_at, created_by)
         VALUES ($1, $2, 'active', true, NOW(), $3)
         ON CONFLICT (student_id, group_id) WHERE status = 'active'
         DO UPDATE SET is_primary = true, ended_at = NULL, updated_at = NOW()`,
        [studentId, toGroupId, req.user!.id],
      );

      const updatedStudent = await updateRow('academy_students', studentId, {
        groupId: toGroupId,
        courseId: Number(targetGroup.courseId),
        schoolId: Number(targetGroup.schoolId),
      });
      if (!updatedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }

      if (lockedStudent.leadId) {
        await updateRow('academy_leads', Number(lockedStudent.leadId), {
          enrolledGroupId: toGroupId,
          courseId: Number(targetGroup.courseId),
          schoolId: Number(targetGroup.schoolId),
        });
      }
      await insertRow('academy_student_transfers', {
        studentId,
        fromGroupId: lockedStudent.groupId ?? null,
        toGroupId,
        reason: nullableText(req.body.reason) ?? null,
        createdBy: req.user!.id,
      });
      await recalculateStudentMetrics(studentId);
      return updatedStudent;
    });
    res.json(student);
  } catch (error: any) {
    logger.error('Failed to transfer student', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to transfer student') });
  }
});

router.post('/students/:id/groups', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead group access required')) return;
  try {
    const studentId = parseId(req.params.id);
    const groupId = parseId(req.body.groupId);
    const makePrimary = req.body.isPrimary === true;
    const enrolledAt = parseOptionalDate(req.body.enrolledAt, 'enrolledAt') ?? new Date();
    if (!studentId || !groupId) {
      return res.status(400).json({ error: 'Student and group are required' });
    }
    const initialStudent = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!initialStudent) return res.status(404).json({ error: 'Student not found' });
    if (!hasLeadershipAccess(req.user)) {
      const lead = initialStudent.leadId ? await getLead(Number(initialStudent.leadId)) : null;
      if (!lead || !ensureLeadMutationAccess(req, res, lead)) return;
    }

    const student = await withTransaction(async () => {
      if (initialStudent.leadId) {
        await queryOne(`SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE`, [initialStudent.leadId]);
      }
      const lockedStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!lockedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
      const group = await validateEnrollmentGroup(groupId, null, studentId);
      if (!group) throw Object.assign(new Error('Group not found'), { statusCode: 404 });

      const shouldMakePrimary = makePrimary || !lockedStudent.groupId;
      if (shouldMakePrimary) {
        await query(
          `UPDATE academy_student_group_enrollments
           SET is_primary = false, updated_at = NOW()
           WHERE student_id = $1 AND status = 'active' AND is_primary = true`,
          [studentId],
        );
      }
      await query(
        `INSERT INTO academy_student_group_enrollments
           (student_id, group_id, status, is_primary, enrolled_at, created_by)
         VALUES ($1, $2, 'active', $3, $4, $5)
         ON CONFLICT (student_id, group_id) WHERE status = 'active'
         DO UPDATE SET
           is_primary = CASE WHEN EXCLUDED.is_primary THEN true ELSE academy_student_group_enrollments.is_primary END,
           ended_at = NULL,
           updated_at = NOW()`,
        [studentId, groupId, shouldMakePrimary, enrolledAt, req.user!.id],
      );

      if (shouldMakePrimary) {
        const previousGroupId = lockedStudent.groupId ? Number(lockedStudent.groupId) : null;
        const updated = await updateRow('academy_students', studentId, {
          groupId,
          courseId: Number(group.courseId),
          schoolId: Number(group.schoolId),
        });
        if (lockedStudent.leadId) {
          await updateRow('academy_leads', Number(lockedStudent.leadId), {
            enrolledGroupId: groupId,
            courseId: Number(group.courseId),
            schoolId: Number(group.schoolId),
          });
        }
        if (previousGroupId !== groupId) {
          await insertRow('academy_student_transfers', {
            studentId,
            fromGroupId: previousGroupId,
            toGroupId: groupId,
            reason: nullableText(req.body.reason) ?? 'Изменена основная группа',
            createdBy: req.user!.id,
          });
        }
        await recalculateStudentMetrics(studentId);
        return updated;
      }
      return lockedStudent;
    });
    res.status(201).json(student);
  } catch (error: any) {
    logger.error('Failed to add student group', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to add student group') });
  }
});

router.delete('/students/:id/groups/:groupId', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead group access required')) return;
  try {
    const studentId = parseId(req.params.id);
    const groupId = parseId(req.params.groupId);
    if (!studentId || !groupId) {
      return res.status(400).json({ error: 'Student and group are required' });
    }
    const initialStudent = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!initialStudent) return res.status(404).json({ error: 'Student not found' });
    if (!hasLeadershipAccess(req.user)) {
      const lead = initialStudent.leadId ? await getLead(Number(initialStudent.leadId)) : null;
      if (!lead || !ensureLeadMutationAccess(req, res, lead)) return;
    }

    const student = await withTransaction(async () => {
      if (initialStudent.leadId) {
        await queryOne(`SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE`, [initialStudent.leadId]);
      }
      const lockedStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!lockedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      const membership = await queryOne(
        `SELECT *
         FROM academy_student_group_enrollments
         WHERE student_id = $1 AND group_id = $2 AND status = 'active'
         FOR UPDATE`,
        [studentId, groupId],
      );
      if (!membership) {
        throw Object.assign(new Error('Student group membership not found'), { statusCode: 404 });
      }
      const activeCount = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM academy_student_group_enrollments
         WHERE student_id = $1 AND status = 'active'`,
        [studentId],
      );
      if (lockedStudent.status === 'studying' && Number(activeCount?.count ?? 0) <= 1) {
        throw Object.assign(new Error('studentRequiresAtLeastOneGroup'), { statusCode: 409 });
      }

      await query(
        `UPDATE academy_student_group_enrollments
         SET status = 'withdrawn', is_primary = false, ended_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [membership.id],
      );
      if (!membership.isPrimary) return lockedStudent;

      const replacement = await queryOne(
        `SELECT enrollment.*, academy_group.course_id, academy_group.school_id
         FROM academy_student_group_enrollments enrollment
         JOIN academy_groups academy_group ON academy_group.id = enrollment.group_id
         WHERE enrollment.student_id = $1 AND enrollment.status = 'active'
         ORDER BY enrollment.enrolled_at, enrollment.id
         LIMIT 1
         FOR UPDATE OF enrollment`,
        [studentId],
      );
      if (replacement) {
        await query(
          `UPDATE academy_student_group_enrollments
           SET is_primary = true, updated_at = NOW()
           WHERE id = $1`,
          [replacement.id],
        );
      }
      const updated = await updateRow('academy_students', studentId, {
        groupId: replacement?.groupId ?? null,
        courseId: replacement?.courseId ? Number(replacement.courseId) : null,
        schoolId: replacement?.schoolId ? Number(replacement.schoolId) : null,
      });
      if (lockedStudent.leadId) {
        await updateRow('academy_leads', Number(lockedStudent.leadId), {
          enrolledGroupId: replacement?.groupId ?? null,
          courseId: replacement?.courseId ? Number(replacement.courseId) : null,
          schoolId: replacement?.schoolId ? Number(replacement.schoolId) : null,
        });
      }
      await insertRow('academy_student_transfers', {
        studentId,
        fromGroupId: groupId,
        toGroupId: replacement?.groupId ?? null,
        reason: nullableText(req.body.reason) ?? 'Удалено зачисление в основную группу',
        createdBy: req.user!.id,
      });
      await recalculateStudentMetrics(studentId);
      return updated;
    });
    res.json(student);
  } catch (error: any) {
    logger.error('Failed to remove student group', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to remove student group') });
  }
});

router.patch('/students/:id/status', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    const status = nullableText(req.body.status);
    const exitReason = nullableText(req.body.exitReason);
    if (!id) return res.status(400).json({ error: 'Invalid student id' });
    if (!status || !STUDENT_STATUSES.some((item) => item.code === status)) {
      return res.status(400).json({ error: 'Invalid student status' });
    }
    if (['paused', 'expelled'].includes(status) && (!exitReason || !CHURN_REASONS.includes(exitReason as typeof CHURN_REASONS[number]))) {
      return res.status(400).json({ error: 'Churn reason is required for paused or expelled students' });
    }
    const { current, student } = await withTransaction(async () => {
      const lockedStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!lockedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (getAssignedWorkspaces(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
        const teacherId = await resolveTeacherId(req.user!.id);
        const ownsStudent = teacherId
          ? await queryOne(
            `SELECT enrollment.id
             FROM academy_student_group_enrollments enrollment
             JOIN academy_groups academy_group ON academy_group.id = enrollment.group_id
             WHERE enrollment.student_id = $1
               AND enrollment.status = 'active'
               AND academy_group.teacher_id = $2
             LIMIT 1`,
            [id, teacherId],
          )
          : null;
        if (!ownsStudent) {
          throw Object.assign(
            new Error('Teacher can update only own students'),
            { statusCode: 403 },
          );
        }
      }
      if (status === 'studying' && lockedStudent.status !== 'studying') {
        if (!lockedStudent.groupId) {
          throw Object.assign(new Error('groupRequiredForEnrollment'), { statusCode: 409 });
        }
        await queryOne(
          `SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`,
          [lockedStudent.groupId],
        );
        await validateEnrollmentGroup(Number(lockedStudent.groupId));
      }
      const updatedStudent = await updateRow('academy_students', id, {
        status,
        exitReason: ['paused', 'expelled'].includes(status) ? exitReason : null,
      });
      if (!updatedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (lockedStudent.status !== status) {
        await insertRow('academy_student_status_history', {
          studentId: id,
          fromStatus: lockedStudent.status,
          toStatus: status,
          changedBy: req.user!.id,
          comment: nullableText(req.body.comment) ?? null,
        });
        await recalculateStudentMetrics(id);
      }
      return { current: lockedStudent, student: updatedStudent };
    });
    await createAudit(req, 'UPDATE_ACADEMY_STUDENT_STATUS', 'academy_student', id, student, current);
    res.json(student);
  } catch (error: any) {
    logger.error('Failed to update student status', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to update student status') });
  }
});
};
