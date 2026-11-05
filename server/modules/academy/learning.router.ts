import { reconcileStudentAbsenceTask } from "./student-absence-task";
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
  buildFollowingRecurringLessonSchedule,
  buildRecurringLessonSchedule,
  type CalendarDate,
} from '../../lib/lesson-schedule';
import { runAutomations } from '../../services/automations';
import { onlinePbxClient, OnlinePbxError } from '../../services/onlinepbx';
import { syncLeadSourceChannel } from '../../services/lead-channels';
import { getWorkforcePolicy, maskPhone } from '../../services/workforce-policy';
import {
  FINAL_PROJECT_STATUSES,
  GROUP_STATUSES,
  LEAD_ARCHIVE_REASON_CODES,
  LEAD_STATUSES,
  LESSON_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  STUDENT_STATUSES,
  TARGET_ATTENDANCE_PERCENT,
  TARGET_CAC_UZS,
  TARGET_LTV_CAC_RATIO,
  TARGET_NPS,
  TARGET_ROAS,
  addDays,
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
  hasLeadershipAccess,
  normalizeMoney,
  resolveStudentRiskFlags,
  suggestCourseSlugByAge,
} from '@shared/academy';
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
  ACADEMY_SCHEDULING_ADVISORY_LOCK,
  LEAD_MODULES,
  OPERATIONS_MODULES,
  Row,
  canMutateLeadRow,
  createAudit,
  ensureLeadMutationAccess,
  ensureOperationsAccess,
  ensureModuleAccess,
  getActiveLeadStatus,
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
  createStageHistory,
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
  restoreArchivedGroupLessons,
} from './academy-route-support';
import { actorContextFrom } from '../leads/domain/actor-context';
import { canManageTeacherLesson, canRecordTeacherLessonAttendance } from './teacher-lesson-access';

export const registerAcademyLearningRoutes = (router: ReturnType<typeof Router>) => {
router.get('/lessons/:id/attendance-roster', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    const actor = req.actor ?? actorContextFrom(req.user);
    const result = await withTransaction(async () => {
      const lesson = await queryOne(
        `SELECT lesson.*, teacher.user_id AS teacher_user_id,
           (lesson.status <> 'conducted' AND EXISTS (
             SELECT 1 FROM academy_lessons previous_lesson WHERE previous_lesson.group_id=lesson.group_id
               AND previous_lesson.status='scheduled' AND previous_lesson.scheduled_at<lesson.scheduled_at
           )) AS has_previous_incomplete_lesson
         FROM academy_lessons lesson
         LEFT JOIN academy_teachers teacher
           ON teacher.id = lesson.teacher_id AND teacher.status = 'active'
         WHERE lesson.id = $1 FOR SHARE OF lesson`,
        [lessonId],
      );
      if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      if (!await canRecordTeacherLessonAttendance(actor, lesson)) {
        throw Object.assign(new Error('teacherOwnLessonRosterOnly'), { statusCode: 403 });
      }
      const [students, attendance] = await Promise.all([
        getLessonRoster(Number(lesson.groupId), lesson.scheduledAt),
        query(`SELECT * FROM academy_attendance WHERE lesson_id = $1 ORDER BY student_id`, [lessonId]),
      ]);
      return {
        lesson: { ...lesson, canManageLesson: canManageTeacherLesson(actor, lesson) },
        students: actor.modules.includes('teacher') && !actor.isLeadership ? students.map(student => ({
          id: student.id, studentName: student.studentName, contactName: student.contactName,
          attendancePercent: student.attendancePercent, progressPercent: student.progressPercent, status: student.status,
        })) : students,
        attendance,
      };
    });
    res.json(result);
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
        getAssignedModules(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('teacherOwnLessonRescheduleOnly'), { statusCode: 403 });
      }
      const previousScheduledAt = new Date(lesson.scheduledAt);
      if (nextScheduledAt.getTime() === previousScheduledAt.getTime()) {
        throw Object.assign(new Error('rescheduleDateMustChange'), { statusCode: 400 });
      }
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
               AND affected_lesson.lesson_number > $2
             )
           )
         ORDER BY affected_lesson.lesson_number, affected_lesson.id
         FOR UPDATE OF affected_lesson`,
        [lesson.groupId, lesson.lessonNumber, lessonId],
      );
      if (!affected.some((item) => Number(item.id) === lessonId)) {
        throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      }

      const group = await queryOne(
        `SELECT * FROM academy_groups WHERE id = $1 FOR SHARE`,
        [lesson.groupId],
      );
      if (!group) {
        throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
      }
      const followingLessons = affected.filter((item) => Number(item.id) !== lessonId);
      // If the selected lesson moves earlier, its vacated regular slot must not
      // be reused as the very next lesson. Resume after whichever occurrence is
      // later: the original lesson or the end of its one-off replacement.
      const rescheduledLessonEndsAt = new Date(
        nextScheduledAt.getTime() + Number(lesson.durationMinutes) * 60_000,
      );
      const followingScheduleAnchor = new Date(Math.max(
        previousScheduledAt.getTime(),
        rescheduledLessonEndsAt.getTime(),
      ));
      const followingSlots = buildFollowingRecurringLessonSchedule({
        after: followingScheduleAnchor,
        schedule: group.schedule,
        lessonCount: followingLessons.length,
        fallbackDurationMinutes: Number(group.lessonDurationMinutes),
        timeZone: ACADEMY_TIME_ZONE,
      });
      if (followingSlots.length !== followingLessons.length) {
        throw Object.assign(new Error('groupLessonGenerationFailed'), { statusCode: 409 });
      }
      const followingSlotByLessonId = new Map(
        followingLessons.map((item, index) => [Number(item.id), followingSlots[index]]),
      );

      const plannedChanges = affected.flatMap((affectedLesson) => {
        const isTarget = Number(affectedLesson.id) === lessonId;
        const slot = isTarget ? null : followingSlotByLessonId.get(Number(affectedLesson.id));
        const scheduledAt = isTarget ? nextScheduledAt : slot?.scheduledAt;
        const durationMinutes = isTarget
          ? Number(affectedLesson.durationMinutes)
          : slot?.durationMinutes;
        if (!scheduledAt || !Number.isFinite(durationMinutes)) return [];
        const reopensConductedLesson = isTarget && lesson.status === 'conducted';
        const changed = scheduledAt.getTime() !== new Date(affectedLesson.scheduledAt).getTime()
          || Number(durationMinutes) !== Number(affectedLesson.durationMinutes)
          || reopensConductedLesson;
        return changed ? [{
          lesson: affectedLesson,
          scheduledAt,
          durationMinutes: Number(durationMinutes),
          reopensConductedLesson,
        }] : [];
      });
      if (
        getAssignedModules(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && plannedChanges.some(({ lesson: item }) => Number(item.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('teacherOwnLessonRescheduleOnly'), { statusCode: 403 });
      }
      const affectedLessonIds = plannedChanges.map(({ lesson: item }) => Number(item.id));
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

      const updatedLessons: Row[] = [];
      for (const change of plannedChanges) {
        const affectedLesson = change.lesson;
        const oldDate = new Date(affectedLesson.scheduledAt);
        const newDate = change.scheduledAt;
        const values: Row = {
          scheduledAt: newDate,
          durationMinutes: change.durationMinutes,
          ...(change.reopensConductedLesson ? { status: 'scheduled' } : {}),
        };
        await prepareLessonMutation({
          values,
          oldRow: affectedLesson,
          excludeLessonId: Number(affectedLesson.id),
          excludeLessonIds: affectedLessonIds,
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
        if (change.reopensConductedLesson) {
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
      if (!await canRecordTeacherLessonAttendance(req.actor ?? actorContextFrom(req.user), lesson)) {
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

      const previousMarks = await query<{ studentId: number; status: string }>(
        "SELECT student_id,status FROM academy_attendance WHERE lesson_id=$1 FOR UPDATE",
        [lessonId],
      );
      const previousStatus = new Map(previousMarks.map(mark => [Number(mark.studentId), mark.status]));
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
      if (requestedLessonStatus === 'conducted') {
        for (const item of normalizedItems) {
          const newAbsence = item.status === 'absent'
            && (previousStatus.get(item.studentId) !== 'absent' || lesson.status !== 'conducted');
          await reconcileStudentAbsenceTask(studentsById.get(item.studentId)!, Number(lesson.groupId), req.user!.id,
            newAbsence ? [lessonId] : []);
        }
      }

      for (const student of groupStudents) {
        await recalculateStudentMetrics(Number(student.id));
      }

      return { lesson: updatedLesson, attendance: saved };
    });

    res.json({ lesson: result.lesson, attendance: result.attendance });
  } catch (error: any) {
    logger.error('Failed to save attendance', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to save attendance') });
  }
});

router.post('/students/:id/transfer', async (req, res) => {
  if (!ensureModuleAccess(req, res, OPERATIONS_MODULES, 'Operations access required')) return;
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
      if (lockedStudent.isArchived) {
        throw Object.assign(new Error('archivedStudentMustBeRestoredBeforeUpdate'), { statusCode: 409 });
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
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead group access required')) return;
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
    const initialLead = initialStudent.leadId ? await getLead(Number(initialStudent.leadId)) : null;
    if (!hasLeadershipAccess(req.user)) {
      if (!initialLead || !ensureLeadMutationAccess(req, res, initialLead)) return;
    }

    const student = await withTransaction(async () => {
      const lockedLead = initialStudent.leadId
        ? await queryOne(`SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [initialStudent.leadId])
        : null;
      const lockedStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!lockedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (lockedStudent.isArchived) {
        throw Object.assign(new Error('archivedStudentMustBeRestoredBeforeUpdate'), { statusCode: 409 });
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
        const activatesTrialStudent = ['trial', 'waiting_start'].includes(lockedStudent.status);
        const enrollmentStatus = group.status === 'planned' ? 'waiting_start' : 'studying';
        const startsTeaching = activatesTrialStudent && group.status !== 'planned';
        const updated = await updateRow('academy_students', studentId, {
          groupId,
          courseId: Number(group.courseId),
          schoolId: Number(group.schoolId),
          status: activatesTrialStudent ? enrollmentStatus : lockedStudent.status,
          enrolledAt: startsTeaching ? enrolledAt : lockedStudent.enrolledAt,
          enrollmentDate: startsTeaching ? enrolledAt : lockedStudent.enrollmentDate,
        });
        if (lockedStudent.leadId) {
          const leadUpdates: Row = {
            enrolledGroupId: groupId,
            courseId: Number(group.courseId),
            schoolId: Number(group.schoolId),
          };
          await updateRow('academy_leads', Number(lockedStudent.leadId), leadUpdates);
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
        if (activatesTrialStudent && enrollmentStatus !== lockedStudent.status) {
          await insertRow('academy_student_status_history', {
            studentId,
            fromStatus: lockedStudent.status,
            toStatus: enrollmentStatus,
            changedBy: req.user!.id,
            comment: group.status === 'planned' ? 'Запись в будущую группу' : 'Пробный ученик зачислен в учебную группу',
          });
        }
        await recalculateStudentMetrics(studentId);
        return updated;
      }
      await recalculateStudentMetrics(studentId);
      return lockedStudent;
    });
    res.status(201).json(student);
  } catch (error: any) {
    logger.error('Failed to add student group', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to add student group') });
  }
});

router.delete('/students/:id/groups/:groupId', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead group access required')) return;
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

const STUDENT_STATUS_MODULES = new Set([...OPERATIONS_MODULES, 'teacher', 'sales']);
/** Sending a pupil away and bringing them back is a decision of the office, not of a teacher. */
const STUDENT_ARCHIVE_MODULES = new Set([...OPERATIONS_MODULES, 'sales']);

/**
 * Sales may change only their own pupils, a teacher only pupils of own groups.
 * Archiving is an office or sales decision, so a teacher module never widens it.
 */
const studentChangeAccess = async (req: any, res: any, id: number, scope: 'learning' | 'archive' = 'learning') => {
  const modules = getAssignedModules(req.user);
  const salesOnly = modules.includes('sales') && !hasLeadershipAccess(req.user)
    && !modules.includes('administration') && (scope === 'archive' || !modules.includes('teacher'));
  const initialStudent = salesOnly ? await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [id]) : null;
  if (salesOnly) {
    if (!initialStudent) {
      res.status(404).json({ error: 'Student not found' });
      return null;
    }
    if (Number(initialStudent.managerId) !== Number(req.user!.id)) {
      res.status(403).json({ error: 'Student update access required' });
      return null;
    }
    const lead = initialStudent.leadId ? await getLead(Number(initialStudent.leadId)) : null;
    if (initialStudent.leadId && !lead) {
      res.status(404).json({ error: 'Lead not found' });
      return null;
    }
    if (lead && !ensureLeadMutationAccess(req, res, lead)) return null;
  }
  return { salesOnly, initialStudent, scope };
};

const lockStudentForChange = async (
  req: any,
  id: number,
  access: { salesOnly: boolean; initialStudent?: Row | null; scope?: 'learning' | 'archive' },
) => {
  // Match the lead -> student lock order used by enrollment and payment changes.
  const lockedLead = access.salesOnly && access.initialStudent?.leadId ? await queryOne(
    `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [access.initialStudent.leadId],
  ) : null;
  const lockedStudent = await queryOne(
    `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!lockedStudent) {
    throw Object.assign(new Error('Student not found'), { statusCode: 404 });
  }
  if (access.salesOnly && (
    Number(lockedStudent.managerId) !== Number(req.user!.id)
    || lockedStudent.leadId !== access.initialStudent?.leadId
    || (lockedStudent.leadId && (!lockedLead || !canMutateLeadRow(req, lockedLead)))
  )) {
    throw Object.assign(new Error('Student update access required'), { statusCode: 403 });
  }
  if (access.scope !== 'archive' && getAssignedModules(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
    const teacherId = await resolveTeacherId(req.user!.id);
    // Archived pupils keep their suspended memberships and stay with the
    // teacher of the group they left.
    const ownsStudent = teacherId
      ? await queryOne(
        `SELECT enrollment.id
         FROM academy_student_group_enrollments enrollment
         JOIN academy_groups academy_group ON academy_group.id = enrollment.group_id
         WHERE enrollment.student_id = $1
           AND enrollment.status IN ('active', 'suspended')
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
  return lockedStudent;
};

router.patch('/students/:id/status', async (req, res) => {
  if (!ensureModuleAccess(req, res, STUDENT_STATUS_MODULES, 'Student update access required')) return;
  try {
    const id = parseId(req.params.id);
    const status = nullableText(req.body.status);
    if (!id) return res.status(400).json({ error: 'Invalid student id' });
    if (!status || !STUDENT_STATUSES.some((item) => item.code === status)) {
      return res.status(400).json({ error: 'Invalid student status' });
    }
    const access = await studentChangeAccess(req, res, id);
    if (!access) return;
    const { current, student } = await withTransaction(async () => {
      const lockedStudent = await lockStudentForChange(req, id, access);
      if (lockedStudent.isArchived) {
        throw Object.assign(new Error('archivedStudentMustBeRestoredBeforeUpdate'), { statusCode: 409 });
      }
      if (status === 'studying' && lockedStudent.status !== 'studying') {
        if (!lockedStudent.groupId) {
          throw Object.assign(new Error('groupRequiredForEnrollment'), { statusCode: 409 });
        }
        const memberships = await query<{ groupId: number }>(
          `SELECT group_id FROM academy_student_group_enrollments
           WHERE student_id = $1 AND status = 'active'
           ORDER BY group_id FOR UPDATE`, [id],
        );
        const groupIds = [...new Set([
          Number(lockedStudent.groupId), ...memberships.map((membership) => Number(membership.groupId)),
        ])].sort((left, right) => left - right);
        for (const groupId of groupIds) {
          await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
          await validateEnrollmentGroup(groupId, null, id);
        }
      }
      const updatedStudent = await updateRow('academy_students', id, { status });
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

/**
 * A pupil who leaves for a while is archived, not paused. The archive frees the
 * group places and takes the pupil out of future registers; past lessons,
 * marks and payments stay untouched. Memberships are suspended rather than
 * withdrawn, so a restore can return the pupil to the same groups.
 */
router.post('/students/:id/archive', async (req, res) => {
  if (!ensureModuleAccess(req, res, STUDENT_ARCHIVE_MODULES, 'Student update access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid student id' });
    const access = await studentChangeAccess(req, res, id, 'archive');
    if (!access) return;
    const { current, student } = await withTransaction(async () => {
      const lockedStudent = await lockStudentForChange(req, id, access);
      if (lockedStudent.isArchived) return { current: lockedStudent, student: lockedStudent };
      await query(
        `UPDATE academy_student_group_enrollments
         SET status = 'suspended', ended_at = GREATEST(NOW(), enrolled_at), updated_at = NOW()
         WHERE student_id = $1 AND status = 'active'`,
        [id],
      );
      const archived = await updateRow('academy_students', id, {
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: req.user!.id,
        groupId: null,
      });
      if (!archived) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      // Registers and attendance metrics read the status history at lesson
      // time, so the archived interval must be recorded there as well.
      await insertRow('academy_student_status_history', {
        studentId: id,
        fromStatus: lockedStudent.status,
        toStatus: 'archived',
        changedBy: req.user!.id,
        comment: 'Отправлен в архив',
      });
      await recalculateStudentMetrics(id);
      return { current: lockedStudent, student: archived };
    });
    if (current !== student) {
      await createAudit(req, 'ARCHIVE_ACADEMY_STUDENT', 'academy_student', id, student, current);
    }
    res.json(student);
  } catch (error: any) {
    logger.error('Failed to archive student', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to archive student') });
  }
});

router.post('/students/:id/restore', async (req, res) => {
  if (!ensureModuleAccess(req, res, STUDENT_ARCHIVE_MODULES, 'Student update access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid student id' });
    const returnToGroups = req.body?.returnToGroups !== false;
    const access = await studentChangeAccess(req, res, id, 'archive');
    if (!access) return;
    const { current, student, restoredGroupIds, skippedGroupIds } = await withTransaction(async () => {
      const lockedStudent = await lockStudentForChange(req, id, access);
      if (!lockedStudent.isArchived) {
        return { current: lockedStudent, student: lockedStudent, restoredGroupIds: [], skippedGroupIds: [] };
      }
      // Only the memberships suspended by the latest archive are candidates.
      const suspended = await query<{ id: number; groupId: number; isPrimary: boolean }>(
        `SELECT id, group_id, is_primary
         FROM academy_student_group_enrollments
         WHERE student_id = $1 AND status = 'suspended'
           AND updated_at = (
             SELECT MAX(updated_at) FROM academy_student_group_enrollments
             WHERE student_id = $1 AND status = 'suspended'
           )
         ORDER BY group_id
         FOR UPDATE`,
        [id],
      );
      const restored: Array<{
        groupId: number; isPrimary: boolean; planned: boolean; courseId: number; schoolId: number | null;
      }> = [];
      const skipped: number[] = [];
      for (const membership of returnToGroups ? suspended : []) {
        const groupId = Number(membership.groupId);
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
        try {
          const group = await validateEnrollmentGroup(groupId, null, id);
          if (!group) throw Object.assign(new Error('Group not found'), { statusCode: 404 });
          restored.push({
            groupId, isPrimary: membership.isPrimary, planned: group.status === 'planned',
            courseId: Number(group.courseId), schoolId: group.schoolId ? Number(group.schoolId) : null,
          });
        } catch (error: any) {
          // A full or closed group is skipped; the pupil can join another one.
          if (error?.statusCode !== 409 && error?.statusCode !== 404) throw error;
          skipped.push(groupId);
        }
      }
      // An active primary group cannot appear while archived, but never create a second one.
      const activePrimary = await queryOne(
        `SELECT id FROM academy_student_group_enrollments
         WHERE student_id = $1 AND status = 'active' AND is_primary = true LIMIT 1`,
        [id],
      );
      const primary = activePrimary ? null : restored.find((membership) => membership.isPrimary) ?? restored[0] ?? null;
      for (const membership of restored) {
        await query(
          `INSERT INTO academy_student_group_enrollments
             (student_id, group_id, status, is_primary, enrolled_at, created_by)
           VALUES ($1, $2, 'active', $3, NOW(), $4)
           ON CONFLICT (student_id, group_id) WHERE status = 'active' DO NOTHING`,
          [id, membership.groupId, membership.groupId === primary?.groupId, req.user!.id],
        );
      }
      await query(
        `UPDATE academy_student_group_enrollments
         SET status = 'withdrawn', is_primary = false, updated_at = NOW()
         WHERE student_id = $1 AND status = 'suspended'`,
        [id],
      );
      // A pupil returned to a running group studies again, and one returned only
      // to planned groups waits for the start. Without a group the pupil waits
      // for a new one as a trial pupil, like a newly created pupil.
      const status = restored.length > 0
        ? restored.some((membership) => !membership.planned) ? 'studying' : 'waiting_start'
        : ['studying', 'waiting_start'].includes(lockedStudent.status) ? 'trial' : lockedStudent.status;
      const restoredStudent = await updateRow('academy_students', id, {
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        status,
        ...(primary ? { groupId: primary.groupId, courseId: primary.courseId, schoolId: primary.schoolId } : {}),
      });
      if (!restoredStudent) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      await insertRow('academy_student_status_history', {
        studentId: id,
        fromStatus: 'archived',
        toStatus: status,
        changedBy: req.user!.id,
        comment: 'Восстановлен из архива',
      });
      await recalculateStudentMetrics(id);
      return {
        current: lockedStudent,
        student: restoredStudent,
        restoredGroupIds: restored.map((membership) => membership.groupId),
        skippedGroupIds: skipped,
      };
    });
    if (current !== student) {
      await createAudit(req, 'RESTORE_ACADEMY_STUDENT', 'academy_student', id,
        { ...student, restoredGroupIds, skippedGroupIds }, current);
    }
    res.json({ ...student, restoredGroupIds, skippedGroupIds });
  } catch (error: any) {
    logger.error('Failed to restore student', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to restore student') });
  }
});

/**
 * Archiving is deliberately not a status. `completed` describes where a group
 * stands in its own lifecycle; the archive says whether anybody still wants to
 * see it, and only the second one may hide lessons from a calendar. Keeping
 * them apart is what lets a group be finished today and shelved next month —
 * and lets the shelving be undone without rewriting the group's history.
 */
const loadGroupForArchive = async (groupId: number) => queryOne(
  `SELECT g.*, teacher.user_id AS teacher_user_id
   FROM academy_groups g
   LEFT JOIN academy_teachers teacher ON teacher.id = g.teacher_id
   WHERE g.id = $1`,
  [groupId],
);

const ensureGroupArchiveAccess = (req: any, res: any, group: Row) => {
  const isAdministrator = hasLeadershipAccess(req.user)
    || getAssignedModules(req.user).some((module) => ['administration', 'sales'].includes(module));
  if (isAdministrator) return true;
  if (!group.teacherUserId || Number(group.teacherUserId) !== Number(req.user!.id)) {
    res.status(403).json({ error: 'teacherOwnGroupArchiveOnly' });
    return false;
  }
  return true;
};

router.post('/groups/:id/archive', async (req, res) => {
  if (!getAssignedModules(req.user).includes('sales') && !ensureOperationsAccess(req, res)) return;
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return res.status(400).json({ error: 'Invalid group id' });
    const group = await loadGroupForArchive(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!ensureGroupArchiveAccess(req, res, group)) return;
    /* A teacher shelves a course that is over, never one that is still running:
       sales and administration may end a group, and ending it is a separate decision
       from filing it away. */
    const isAdministrator = hasLeadershipAccess(req.user)
      || getAssignedModules(req.user).some((module) => ['administration', 'sales'].includes(module));
    if (!isAdministrator && group.status !== 'completed') {
      return res.status(409).json({ error: 'onlyCompletedGroupsCanBeArchived' });
    }
    if (group.isArchived === true) return res.json(group);

    const archived = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
      const lockedGroup = await queryOne(
        `SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE`,
        [groupId],
      );
      if (!lockedGroup) throw Object.assign(new Error('Group not found'), { statusCode: 404 });
      if (lockedGroup.isArchived === true) return lockedGroup;
      const values: Row = {
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: req.user!.id,
      };
      return updateRow('academy_groups', groupId, values);
    });
    await createAudit(req, 'ARCHIVE_ACADEMY_GROUP', 'academy_group', groupId, archived, group);
    res.json(archived);
  } catch (error: any) {
    logger.error('Failed to archive group', { error, groupId: req.params.id });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to archive group') });
  }
});

router.post('/groups/:id/unarchive', async (req, res) => {
  if (!getAssignedModules(req.user).includes('sales') && !ensureOperationsAccess(req, res)) return;
  try {
    const groupId = parseId(req.params.id);
    if (!groupId) return res.status(400).json({ error: 'Invalid group id' });
    const group = await loadGroupForArchive(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!ensureGroupArchiveAccess(req, res, group)) return;
    if (group.isArchived !== true) return res.json(group);

    const restored = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
      const lockedGroup = await queryOne(
        `SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE`,
        [groupId],
      );
      if (!lockedGroup) throw Object.assign(new Error('Group not found'), { statusCode: 404 });
      if (lockedGroup.isArchived !== true) return lockedGroup;
      const updatedGroup = await updateRow('academy_groups', groupId, {
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
      });
      if (!updatedGroup) throw Object.assign(new Error('Group not found'), { statusCode: 404 });
      await restoreArchivedGroupLessons(updatedGroup, req.user!.id);
      return await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [groupId]) ?? updatedGroup;
    });
    await createAudit(req, 'UNARCHIVE_ACADEMY_GROUP', 'academy_group', groupId, restored, group);
    res.json(restored);
  } catch (error: any) {
    logger.error('Failed to restore group from the archive', { error, groupId: req.params.id });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to restore group') });
  }
});
};
