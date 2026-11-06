import { studentGroupMetricsSql } from "../../lib/student-group-metrics-sql";
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
  getZonedDateOnlyRange,
  getZonedDayRange,
  getZonedMonthRange,
  zonedWallClockToInstant,
} from '../../lib/academy-time';
import {
  buildFollowingRecurringLessonSchedule,
  buildRecurringLessonSchedule,
} from '../../lib/lesson-schedule';
import { runAutomations } from '../../services/automations';
import { onlinePbxClient, OnlinePbxError } from '../../services/onlinepbx';
import { syncLeadSourceChannel } from '../../services/lead-channels';
import { getWorkforcePolicy, maskPhone } from '../../services/workforce-policy';
import { assertEligibleGroupTeacher } from './group-teacher-eligibility';
import { prepareGroupCourseLessons } from './course-curriculum';
import {
  calendarDateFromDateOnly,
  calendarDateFromInstant,
  calendarDateToUtcMarker,
  groupLessonBackedFieldChanged,
  normalizedGroupScheduleForComparison,
} from './group-lesson-schedule';
import { courseLessonFileIds, courseLessonMaterialsText, orderSelectedCourseLessons } from '@shared/contracts/course-curriculum';
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
  addMinutes,
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
  ACADEMY_SCHEDULING_ADVISORY_LOCK,
  ACADEMY_TIME_ZONE,
  DbValue,
  Row,
  insertRow,
  nullableText,
  query,
  queryOne,
  transactionContext,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  assertActiveRoomInSchool,
  assertGroupLessonSlotFree,
  assertLessonRoomAvailable,
  assertRoomScheduleAvailable,
  assertTeacherCanLeadGroupSchedule,
  assertTeacherCanLeadLesson,
  readJsonArray,
} from './academy-scheduling';
import {
  resolveTeacherId,
} from './academy-analytics';

export {
  calendarDateFromDateOnly,
  calendarDateFromInstant,
  calendarDateToUtcMarker,
  groupLessonBackedFieldChanged,
  normalizedGroupScheduleForComparison,
};

export const buildCrudScope = async (req: any, table: string, firstParamIndex = 1): Promise<{
  whereSql: string;
  params: DbValue[];
  denied?: boolean;
}> => {
  const assignedModules = getAssignedModules(req.user);
  const params: DbValue[] = [];
  const pushParam = (value: DbValue) => {
    params.push(value);
    return `$${firstParamIndex + params.length - 1}`;
  };
  const ownUserParam = () => pushParam(req.user!.id);
  const teacherParam = async () => {
    const teacherId = await resolveTeacherId(req.user!.id);
    return teacherId ? pushParam(teacherId) : null;
  };

  if (table === 'academy_lessons') {
    if (hasLeadershipAccess(req.user)) return { whereSql: '', params };
    if (assignedModules.includes('teacher')) {
      const placeholder = await teacherParam();
      return placeholder ? { whereSql: `teacher_id = ${placeholder}`, params } : { whereSql: 'FALSE', params };
    }
    return { whereSql: 'FALSE', params, denied: true };
  }

  return { whereSql: '', params };
};

export const prepareGroupMutation = async (options: {
  values: Row;
  oldRow?: Row | null;
  excludeGroupId?: number | null;
  allowFutureStart?: boolean;
}) => {
  const teacherId = Number(Object.prototype.hasOwnProperty.call(options.values, 'teacherId')
    ? options.values.teacherId
    : options.oldRow?.teacherId) || null;
  // The format is chosen once, with the group's code; an online group needs
  // neither a branch nor a room and never holds one.
  const deliveryMode = String(options.oldRow?.deliveryMode ?? options.values.deliveryMode ?? 'offline');
  if (!['offline', 'online'].includes(deliveryMode)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  const online = deliveryMode === 'online';
  if (options.oldRow) delete options.values.deliveryMode;
  else options.values.deliveryMode = deliveryMode;
  const courseId = Number(options.values.courseId ?? options.oldRow?.courseId);
  const schoolId = Number(Object.prototype.hasOwnProperty.call(options.values, 'schoolId')
    ? options.values.schoolId
    : options.oldRow?.schoolId) || null;
  const roomId = online ? null : Number(options.values.roomId ?? options.oldRow?.roomId) || null;
  if (online) options.values.roomId = null;
  const schedule = options.values.schedule ?? options.oldRow?.schedule;
  const maxStudents = Number(options.values.maxStudents ?? options.oldRow?.maxStudents ?? 12);
  const status = String(options.values.status ?? options.oldRow?.status ?? 'open');
  if (!courseId || (!online && !schoolId)) {
    throw Object.assign(new Error('schoolAndCourseRequired'), { statusCode: 400 });
  }
  if (!online && !roomId) {
    throw Object.assign(new Error('roomRequired'), { statusCode: 400 });
  }
  options.values.schoolId = schoolId;
  if (!GROUP_STATUSES.some((item) => item.code === status)) {
    throw Object.assign(new Error('Invalid group status'), { statusCode: 400 });
  }
  if (!teacherId && (!options.oldRow || options.oldRow.status === 'planned' || groupSchedulePreparationRequired(options.values, options.oldRow))) {
    throw Object.assign(new Error('teacherRequired'), { statusCode: 400 });
  }
  assertFutureGroupStartAcknowledged({
    status,
    startDate: options.values.startDate ?? options.oldRow?.startDate,
    allowFutureStart: options.allowFutureStart,
  });
  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);

  if (
    options.oldRow
    && (
      Number(options.oldRow.courseId) !== courseId
      || (Number(options.oldRow.schoolId) || null) !== schoolId
    )
  ) {
    const usage = await queryOne<{ hasEnrollments: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM academy_student_group_enrollments
           WHERE group_id = $1
         )
         OR EXISTS (SELECT 1 FROM academy_lessons WHERE group_id = $1)
       ) AS has_enrollments`,
      [options.oldRow.id],
    );
    if (usage?.hasEnrollments) {
      throw Object.assign(new Error('groupHasEnrollments'), { statusCode: 409 });
    }
  }
  const course = await queryOne(
    `SELECT id, lesson_count, lesson_duration_minutes, duration_days, frequency, is_active,
       to_jsonb(academy_courses)->'program' AS program
     FROM academy_courses
     WHERE id = $1`,
    [courseId],
  );
  if (!course) {
    throw Object.assign(new Error('Course not found'), { statusCode: 404 });
  }
  if (course.isActive === false) {
    throw Object.assign(new Error('Course is inactive'), { statusCode: 409 });
  }

  prepareGroupCourseLessons(options.values, options.oldRow, course.program);

  const lessonCount = Number(
    options.values.lessonCount !== undefined
      ? options.values.lessonCount
      : Number(options.oldRow?.lessonCount) > 0
        ? options.oldRow?.lessonCount
        : Number(course.lessonCount) > 0
          ? course.lessonCount
          : 10,
  );
  const lessonDurationMinutes = Number(
    options.values.lessonDurationMinutes !== undefined
      ? options.values.lessonDurationMinutes
      : Number(options.oldRow?.lessonDurationMinutes) >= 15
        ? options.oldRow?.lessonDurationMinutes
        : Number(course.lessonDurationMinutes) >= 15
          ? course.lessonDurationMinutes
          : 120,
  );
  const durationDays = Number(
    options.values.durationDays !== undefined
      ? options.values.durationDays
      : Number(options.oldRow?.durationDays) > 0
        ? options.oldRow?.durationDays
        : Number(course.durationDays) > 0
          ? course.durationDays
          : 30,
  );
  if (lessonCount < 1 || lessonDurationMinutes < 15 || durationDays < 1) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  options.values.lessonCount = Math.round(lessonCount);
  options.values.lessonDurationMinutes = Math.round(lessonDurationMinutes);
  options.values.durationDays = Math.round(durationDays);
  options.values.frequency = options.values.frequency !== undefined
    ? nullableText(options.values.frequency)
    : nullableText(options.oldRow?.frequency ?? course.frequency);

  if (maxStudents < 1) {
    throw Object.assign(new Error('groupCapacityLimit'), { statusCode: 400 });
  }
  if (options.oldRow) {
    const occupancy = await queryOne<{ currentStudents: number; reservedStudents: number }>(
      `SELECT
         COUNT(DISTINCT s.id)::int AS current_students,
         0::int AS reserved_students
       FROM academy_groups g
       LEFT JOIN academy_student_group_enrollments enrollment
         ON enrollment.group_id = g.id AND enrollment.status = 'active'
       LEFT JOIN academy_students s
         ON s.id = enrollment.student_id AND (g.status = 'planned' OR s.status IN ('studying', 'waiting_start'))
       WHERE g.id = $1
       GROUP BY g.id`,
      [options.oldRow.id],
    );
    if (
      Number(occupancy?.currentStudents ?? 0)
      + Number(occupancy?.reservedStudents ?? 0)
      > maxStudents
    ) {
      throw Object.assign(new Error('groupCapacityBelowOccupancy'), { statusCode: 409 });
    }
  }
  options.values.maxStudents = maxStudents;
  if (roomId && schoolId) {
    const room = await assertActiveRoomInSchool(roomId, schoolId);
    // An offline group never takes more pupils than its room seats. Checked
    // when the room or the capacity changes, so an older group stays editable.
    const seatsChanged = !options.oldRow || options.oldRow.status === 'planned'
      || Number(options.oldRow.maxStudents) !== maxStudents
      || (Number(options.oldRow.roomId) || null) !== roomId;
    assertGroupFitsRoom(maxStudents, room, seatsChanged);
  }
  const startDate = (options.values.startDate ?? options.oldRow?.startDate) as Date | null | undefined;
  if (options.oldRow && options.values.selectedCourseLessonIds && startDate) {
    const end = getMinimumGroupEndDate({ startDate: new Date(startDate).toISOString().slice(0, 10), lessonCount: Math.round(lessonCount), schedule });
    if (end) options.values.endDate = new Date(`${end}T00:00:00Z`);
  }
  const endDate = (options.values.endDate ?? options.oldRow?.endDate) as Date | null | undefined;
  if (startDate && endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (startDate && endDate) {
    const startDateKey = new Date(startDate).toISOString().slice(0, 10);
    const endDateKey = new Date(endDate).toISOString().slice(0, 10);
    const minimumEndDate = getMinimumGroupEndDate({
      startDate: startDateKey,
      lessonCount: Math.round(lessonCount),
      schedule,
    });
    if (minimumEndDate && endDateKey < minimumEndDate) {
      throw Object.assign(new Error('groupDateRangeTooShort'), {
        statusCode: 400,
        minimumEndDate,
      });
    }
  }

  // An edited group keeps its past lessons as they were, so only the days
  // from today on may clash with other groups, lessons and demos.
  // Both are calendar-day markers (UTC midnight of the academy's date).
  const checkFrom = options.oldRow && startDate
    ? new Date(Math.max(new Date(startDate).getTime(), calendarDateToUtcMarker(calendarDateFromInstant(new Date())).getTime()))
    : startDate;
  if (status === 'completed') {
    const validationError = getGroupScheduleValidationError(schedule);
    if (validationError) {
      throw Object.assign(new Error(validationError), {
        statusCode: validationError === 'groupScheduleOverlap' ? 409 : 400,
      });
    }
  } else if (!roomId || !schoolId) {
    // An online group holds no room, so only its own timetable is checked.
    const validationError = getGroupScheduleValidationError(schedule);
    if (validationError) {
      throw Object.assign(new Error(validationError), {
        statusCode: validationError === 'groupScheduleRequired' || validationError === 'groupScheduleInvalid' ? 400 : 409,
      });
    }
  } else {
    await query(`SELECT pg_advisory_xact_lock($1)`, [roomId]);
    await assertRoomScheduleAvailable({
      schoolId,
      roomId,
      schedule,
      startDate: checkFrom,
      endDate,
      excludeGroupId: options.excludeGroupId,
    });
  }

  if (!teacherId) {
    options.values.teacherId = null;
    return;
  }
  if (status === 'completed') {
    if (teacherId && teacherId !== Number(options.oldRow?.teacherId)) {
      await assertEligibleGroupTeacher(teacherId);
    }
    options.values.teacherId = teacherId;
    return;
  }
  await query(`SELECT pg_advisory_xact_lock($1)`, [1_000_000 + teacherId]);
  await assertTeacherCanLeadGroupSchedule({
    teacherId,
    existingTeacherId: Number(options.oldRow?.teacherId) || null,
    courseId,
    schoolId,
    schedule,
    startDate: checkFrom,
    endDate,
    excludeGroupId: options.excludeGroupId,
  });
  options.values.teacherId = teacherId;
};

/** A room's seats cap an offline group; online groups have no room. */
export const assertGroupFitsRoom = (maxStudents: number, room: Row, seatsChanged = true) => {
  const seats = Number(room.capacity);
  if (seatsChanged && Number.isSafeInteger(seats) && seats > 0 && maxStudents > seats) {
    throw Object.assign(new Error('groupCapacityExceedsRoom'), { statusCode: 409, roomCapacity: seats });
  }
};

export const GROUP_LESSON_BACKED_FIELDS = [
  'roomId',
  'teacherId',
  'schedule',
  'startDate',
  'endDate',
  'lessonCount',
  'lessonDurationMinutes',
  'durationDays',
  'frequency',
] as const;

export const GROUP_SCHEDULE_PREPARATION_FIELDS = [
  'courseId',
  'schoolId',
  'selectedCourseLessonIds',
  ...GROUP_LESSON_BACKED_FIELDS,
] as const;

export const groupFieldsChanged = (
  fields: readonly string[],
  values: Row,
  row: Row,
) => fields.some((field) =>
  Object.prototype.hasOwnProperty.call(values, field)
  && groupLessonBackedFieldChanged(field, values[field], row[field]));

export const groupSchedulePreparationRequired = (values: Row, row: Row) =>
  groupFieldsChanged(GROUP_SCHEDULE_PREPARATION_FIELDS, values, row);

export const isFutureGroupInProgress = (
  status: unknown,
  startDate: unknown,
  reference = new Date(),
) => {
  if (status !== 'in_progress' || !startDate) return false;
  const parsedStartDate = new Date(startDate as string | number | Date);
  if (Number.isNaN(parsedStartDate.getTime())) return false;
  const groupStart = getZonedDateOnlyRange(parsedStartDate, ACADEMY_TIME_ZONE).start;
  const today = getZonedDayRange(reference, ACADEMY_TIME_ZONE).start;
  return groupStart.getTime() > today.getTime();
};

const assertFutureGroupStartAcknowledged = (options: {
  status: unknown;
  startDate: unknown;
  allowFutureStart?: boolean;
}) => {
  if (
    options.allowFutureStart
    || !isFutureGroupInProgress(options.status, options.startDate)
  ) return;

  const startDate = new Date(options.startDate as string | number | Date)
    .toISOString()
    .slice(0, 10);
  throw Object.assign(new Error('futureGroupInProgressRequiresConfirmation'), {
    statusCode: 409,
    startDate,
  });
};

export const prepareGroupMetadataMutation = async (
  values: Row,
  row: Row,
  options?: { allowFutureStart?: boolean },
) => {
  const status = String(values.status ?? row.status ?? 'open');
  if (!GROUP_STATUSES.some((item) => item.code === status)) {
    throw Object.assign(new Error('Invalid group status'), { statusCode: 400 });
  }
  assertFutureGroupStartAcknowledged({
    status,
    startDate: values.startDate ?? row.startDate,
    allowFutureStart: options?.allowFutureStart,
  });

  if (!Object.prototype.hasOwnProperty.call(values, 'maxStudents')) return;
  const maxStudents = Number(values.maxStudents);
  if (maxStudents === Number(row.maxStudents)) return;
  if (maxStudents < 1) {
    throw Object.assign(new Error('groupCapacityLimit'), { statusCode: 400 });
  }

  const occupancy = await queryOne<{ currentStudents: number; reservedStudents: number }>(
    `SELECT
       COUNT(DISTINCT s.id)::int AS current_students,
       0::int AS reserved_students
     FROM academy_groups g
     LEFT JOIN academy_student_group_enrollments enrollment
       ON enrollment.group_id = g.id AND enrollment.status = 'active'
     LEFT JOIN academy_students s
       ON s.id = enrollment.student_id AND (g.status = 'planned' OR s.status IN ('studying', 'waiting_start'))
     WHERE g.id = $1
     GROUP BY g.id`,
    [row.id],
  );
  if (
    Number(occupancy?.currentStudents ?? 0)
    + Number(occupancy?.reservedStudents ?? 0)
    > maxStudents
  ) {
    throw Object.assign(new Error('groupCapacityBelowOccupancy'), { statusCode: 409 });
  }

  if (row.deliveryMode !== 'online' && Number(row.roomId) && Number(row.schoolId)) {
    assertGroupFitsRoom(maxStudents, await assertActiveRoomInSchool(Number(row.roomId), Number(row.schoolId)));
  }
  values.maxStudents = maxStudents;
};

export const assertGroupLifecycleUpdateAllowed = async (options: {
  id: number;
  values: Row;
  row: Row;
}) => {
  const completesGroup = options.row.status !== 'completed' && options.values.status === 'completed';

  // Timetable, teacher and room edits are always allowed: future lessons
  // follow them (reconcileGroupScheduleLessons) and history stays as it was.
  if (!completesGroup) return;
  const lifecycle = await queryOne<{ hasScheduledLessons: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM academy_lessons lesson
       WHERE lesson.group_id = $1 AND lesson.status = 'scheduled'
     ) AS has_scheduled_lessons`,
    [options.id],
  );
  if (lifecycle?.hasScheduledLessons) {
    throw Object.assign(new Error('groupHasScheduledLessons'), { statusCode: 409 });
  }
};

const lessonAssignmentChanged = (values: Row, row: Row) => [
  'groupId', 'courseId', 'schoolId', 'roomId', 'teacherId', 'lessonNumber', 'scheduledAt', 'durationMinutes',
].some((field) => {
  if (!(field in values)) return false;
  if (field === 'scheduledAt') return new Date(values[field]).getTime() !== new Date(row[field]).getTime();
  return Number(values[field]) !== Number(row[field]);
});

export const assertLessonHistoryUpdateAllowed = async (id: number, values: Row, row: Row) => {
  const changesHistory = lessonAssignmentChanged(values, row);
  if (!changesHistory) return;
  const attendance = row.status === 'conducted' ? null : await queryOne(
    `SELECT id FROM academy_attendance WHERE lesson_id = $1 LIMIT 1`, [id],
  );
  if (row.status === 'conducted' || attendance) {
    throw Object.assign(new Error('lessonHistoryLocked'), { statusCode: 409 });
  }
};

export const prepareLessonMutation = async (options: {
  values: Row;
  oldRow?: Row | null;
  excludeLessonId?: number | null;
  excludeLessonIds?: number[];
}) => {
  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
  const groupId = Number(options.values.groupId ?? options.oldRow?.groupId);
  const group = groupId
    ? await queryOne(`SELECT * FROM academy_groups WHERE id = $1 FOR SHARE`, [groupId])
    : null;
  if (!group) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  if (group.status === 'planned') throw Object.assign(new Error('futureGroupNotLaunched'), { statusCode: 409 });

  const requiresAssignment = !options.oldRow || lessonAssignmentChanged(options.values, options.oldRow);
  const teacherId = Number(Object.prototype.hasOwnProperty.call(options.values, 'teacherId')
    ? options.values.teacherId
    : options.oldRow?.teacherId ?? (requiresAssignment ? group.teacherId : null)) || null;
  if (!teacherId && requiresAssignment) {
    throw Object.assign(new Error('teacherRequired'), { statusCode: 400 });
  }
  options.values.teacherId = teacherId;

  const online = group.deliveryMode === 'online';
  const requestedCourseId = Number(options.values.courseId ?? options.oldRow?.courseId ?? group.courseId);
  const requestedSchoolId = Number(options.values.schoolId ?? options.oldRow?.schoolId ?? group.schoolId) || null;
  if (requestedCourseId !== Number(group.courseId) || requestedSchoolId !== (Number(group.schoolId) || null)) {
    throw Object.assign(new Error('lessonGroupMismatch'), { statusCode: 409 });
  }
  const courseId = Number(group.courseId);
  const schoolId = Number(group.schoolId) || null;
  // Online lessons take no room.
  const roomId = online ? null : Number(options.values.roomId ?? options.oldRow?.roomId ?? group.roomId) || null;
  const scheduledAt = new Date(options.values.scheduledAt ?? options.oldRow?.scheduledAt);
  const status = String(options.values.status ?? options.oldRow?.status ?? 'scheduled');
  const durationMinutes = Number(
    options.values.durationMinutes
      ?? options.oldRow?.durationMinutes
      ?? group.lessonDurationMinutes
      ?? (await queryOne(`SELECT lesson_duration_minutes FROM academy_courses WHERE id = $1`, [courseId]))?.lessonDurationMinutes
      ?? 120,
  );
  const lessonNumber = Number(options.values.lessonNumber ?? options.oldRow?.lessonNumber);

  if (
    !courseId
    || (!online && (!schoolId || !roomId))
    || !Number.isSafeInteger(lessonNumber)
    || lessonNumber < 1
    || Number.isNaN(scheduledAt.getTime())
    || durationMinutes < 15
  ) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!LESSON_STATUSES.some((item) => item.code === status)) {
    throw Object.assign(new Error('Invalid lesson status'), { statusCode: 400 });
  }

  options.values.courseId = courseId;
  options.values.schoolId = schoolId;
  options.values.roomId = roomId;
  options.values.lessonNumber = lessonNumber;
  options.values.durationMinutes = durationMinutes;

  const duplicateLessonNumber = await queryOne(
    `SELECT id
     FROM academy_lessons
     WHERE group_id = $1
       AND lesson_number = $2
       AND ($3::integer IS NULL OR id <> $3)
     LIMIT 1`,
    [groupId, lessonNumber, options.excludeLessonId ?? null],
  );
  if (duplicateLessonNumber) {
    throw Object.assign(new Error('groupLessonNumberDuplicate'), { statusCode: 409 });
  }

  // Cancelling an already conflicting lesson must always be possible.
  if (status === 'cancelled') {
    if (roomId && schoolId) await assertActiveRoomInSchool(roomId, schoolId);
    return;
  }

  if (roomId && schoolId) {
    await query(`SELECT pg_advisory_xact_lock($1)`, [roomId]);
    await assertLessonRoomAvailable({
      schoolId,
      roomId,
      scheduledAt,
      durationMinutes,
      excludeLessonId: options.excludeLessonId,
      excludeLessonIds: options.excludeLessonIds,
      excludeGroupId: groupId,
    });
  } else {
    await assertGroupLessonSlotFree({
      groupId,
      scheduledAt,
      durationMinutes,
      excludeLessonId: options.excludeLessonId,
      excludeLessonIds: options.excludeLessonIds,
    });
  }

  if (!teacherId) return;
  await assertTeacherCanLeadLesson({
    teacherId,
    courseId,
    schoolId,
    scheduledAt,
    durationMinutes,
    excludeGroupId: groupId,
    excludeLessonId: options.excludeLessonId,
    excludeLessonIds: options.excludeLessonIds,
  });
};

export const materializeGroupLessons = async (groupId: number, after?: Date): Promise<Row[]> => {
  if (!transactionContext.getStore()) {
    return withTransaction(() => materializeGroupLessons(groupId, after));
  }

  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
  const group = await queryOne(
    `SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE`,
    [groupId],
  );
  if (!group) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  if (group.isArchived === true || !['open', 'in_progress'].includes(String(group.status)) || !group.teacherId) return [];

  const existingLessons = await query<Row>(
    `SELECT id FROM academy_lessons WHERE group_id = $1 ORDER BY scheduled_at, id`,
    [groupId],
  );
  if (existingLessons.length > 0) return existingLessons;

  const [course, membership] = await Promise.all([
    queryOne(`SELECT program FROM academy_courses WHERE id = $1`, [group.courseId]),
    queryOne<{ membershipStart: Date | null }>(
      `SELECT MIN(COALESCE(enrolled_at, created_at)) AS membership_start
       FROM academy_students
       WHERE group_id = $1`,
      [groupId],
    ),
  ]);
  const explicitStartDate = group.startDate ? new Date(group.startDate) : null;
  const fallbackStart = membership?.membershipStart
    ? new Date(membership.membershipStart)
    : new Date(group.createdAt ?? Date.now());
  let startDate = explicitStartDate && !Number.isNaN(explicitStartDate.getTime())
    ? calendarDateFromDateOnly(explicitStartDate)
    : calendarDateFromInstant(fallbackStart);
  if (after && calendarDateToUtcMarker(startDate) < calendarDateToUtcMarker(calendarDateFromInstant(after))) {
    startDate = calendarDateFromInstant(after);
  }
  const lessonCount = Number(group.lessonCount);
  const generatedSlots = buildRecurringLessonSchedule({
    startDate,
    schedule: group.schedule,
    lessonCount,
    fallbackDurationMinutes: Number(group.lessonDurationMinutes),
    timeZone: ACADEMY_TIME_ZONE,
    after,
  });
  if (generatedSlots.length !== lessonCount) {
    throw Object.assign(new Error('groupLessonGenerationFailed'), { statusCode: 409 });
  }

  const program = readJsonArray(course?.program);
  const selectedLessons = group.selectedCourseLessonIds == null ? null : orderSelectedCourseLessons(course?.program, group.selectedCourseLessonIds);
  const createdLessons: Row[] = [];
  for (const slot of generatedSlots) {
    const selectedLesson = selectedLessons?.[slot.lessonNumber - 1];
    const programLesson = program.find(
      (item) => Number(item.lessonNumber) === slot.lessonNumber,
    );
    const values: Row = {
      groupId,
      courseId: Number(group.courseId),
      schoolId: Number(group.schoolId) || null,
      roomId: Number(group.roomId) || null,
      teacherId: Number(group.teacherId),
      lessonNumber: slot.lessonNumber,
      courseLessonId: selectedLesson?.id ?? null,
      topic: selectedLesson?.title ?? nullableText(programLesson?.topic) ?? `Занятие ${slot.lessonNumber}`,
      materials: selectedLesson ? courseLessonMaterialsText(selectedLesson) : nullableText(programLesson?.description) ?? null,
      materialFileIds: selectedLesson ? courseLessonFileIds(selectedLesson) : [],
      scheduledAt: slot.scheduledAt,
      durationMinutes: slot.durationMinutes,
      status: 'scheduled',
    };
    await prepareLessonMutation({ values });
    createdLessons.push(await insertRow('academy_lessons', values));
  }

  const lastLesson = createdLessons[createdLessons.length - 1];
  const lastLessonDate = calendarDateFromInstant(new Date(lastLesson.scheduledAt));
  await updateRow('academy_groups', groupId, {
    startDate: calendarDateToUtcMarker(after ? calendarDateFromInstant(generatedSlots[0].scheduledAt) : startDate),
    endDate: calendarDateToUtcMarker(lastLessonDate),
  });
  return createdLessons;
};

export const restoreArchivedGroupLessons = async (group: Row, actorId: number, reference = new Date(), reason = 'Возвращение группы из архива') => {
  if (group.status === 'frozen') return;
  const groupId = Number(group.id);
  const lessons = await query<Row>(
    `SELECT * FROM academy_lessons WHERE group_id = $1
     ORDER BY lesson_number, id FOR UPDATE`,
    [groupId],
  );
  const pending = lessons.filter((lesson) => lesson.status === 'scheduled');
  const startBoundary = group.startDate
    ? getZonedDateOnlyRange(new Date(group.startDate), ACADEMY_TIME_ZONE).start.getTime() - 1
    : reference.getTime();
  const after = new Date(Math.max(reference.getTime(), startBoundary));
  if (lessons.length === 0) {
    await materializeGroupLessons(groupId, after);
    return;
  }
  if (pending.length === 0) return;

  const slots = buildFollowingRecurringLessonSchedule({
    after,
    schedule: group.schedule,
    lessonCount: pending.length,
    fallbackDurationMinutes: Number(group.lessonDurationMinutes),
    timeZone: ACADEMY_TIME_ZONE,
  });
  if (slots.length !== pending.length) {
    throw Object.assign(new Error('groupLessonGenerationFailed'), { statusCode: 409 });
  }
  const lessonIds = pending.map((lesson) => Number(lesson.id));
  const attendance = await queryOne(
    `SELECT lesson_id FROM academy_attendance WHERE lesson_id = ANY($1::int[]) LIMIT 1`,
    [lessonIds],
  );
  if (attendance) {
    throw Object.assign(new Error('lessonWithAttendanceCannotBeRescheduled'), { statusCode: 409 });
  }

  for (const [index, lesson] of pending.entries()) {
    const slot = slots[index];
    const values: Row = { scheduledAt: slot.scheduledAt, durationMinutes: slot.durationMinutes };
    await prepareLessonMutation({
      values,
      oldRow: lesson,
      excludeLessonId: Number(lesson.id),
      excludeLessonIds: lessonIds,
    });
    await updateRow('academy_lessons', Number(lesson.id), values);
    if (slot.scheduledAt.getTime() !== new Date(lesson.scheduledAt).getTime()) {
      await insertRow('academy_lesson_reschedules', {
        lessonId: Number(lesson.id),
        previousScheduledAt: new Date(lesson.scheduledAt),
        nextScheduledAt: slot.scheduledAt,
        reason,
        changedBy: actorId,
      });
    }
  }
  const lastDate = new Date(Math.max(
    slots[slots.length - 1].scheduledAt.getTime(),
    ...lessons.filter((lesson) => lesson.status === 'conducted')
      .map((lesson) => new Date(lesson.scheduledAt).getTime()),
  ));
  await updateRow('academy_groups', groupId, {
    endDate: calendarDateToUtcMarker(calendarDateFromInstant(lastDate)),
    // Older archive actions marked an unfinished group completed.
    ...(group.status === 'completed' ? { status: 'in_progress' } : {}),
  });
};

export const assertResourceHasNoScheduledDemos = async (resource: 'school' | 'room' | 'course', id: number) => {
  const demo = await queryOne(
    `SELECT id FROM academy_demo_lessons
     WHERE ${resource}_id = $1 AND status = 'scheduled'
       AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > NOW()
     LIMIT 1`, [id],
  );
  if (demo) throw Object.assign(new Error('resourceHasScheduledDemos'), { statusCode: 409 });
};

export const getLeadCountForStatusCode = async (statusCode: string) => {
  const usage = await queryOne<{ leadCount: number | string }>(
    `SELECT COUNT(*)::int AS lead_count
     FROM academy_leads
     WHERE status_code = $1`,
    [statusCode],
  );
  return Number(usage?.leadCount ?? 0);
};

export const getLessonRoster = async (groupId: number, scheduledAt: Date | string, lock = false) => query(
  `SELECT student.*,COALESCE(group_metrics.attendance_percent,0) AS attendance_percent,
     COALESCE(group_metrics.progress_percent,0) AS progress_percent
   FROM academy_students student
   LEFT JOIN LATERAL (
     SELECT membership.enrolled_at,membership.ended_at FROM academy_student_group_enrollments membership
     WHERE membership.student_id=student.id AND membership.group_id=$1 AND membership.enrolled_at<=$2
       AND (membership.ended_at IS NULL OR membership.ended_at>$2)
     ORDER BY membership.enrolled_at DESC,membership.id DESC LIMIT 1
   ) roster_membership ON true
   LEFT JOIN LATERAL (${studentGroupMetricsSql("student.id", "$1", "COALESCE(roster_membership.enrolled_at,student.enrolled_at,student.created_at)", "roster_membership.ended_at")}) group_metrics ON true
   WHERE COALESCE(student.enrolled_at, student.created_at) <= $2
     AND (
       EXISTS (
         SELECT 1
         FROM academy_student_group_enrollments membership
         WHERE membership.student_id = student.id
           AND membership.group_id = $1
           AND membership.enrolled_at <= $2
           AND (membership.ended_at IS NULL OR membership.ended_at > $2)
       )
       OR (
         NOT EXISTS (
           SELECT 1
           FROM academy_student_group_enrollments dated_membership
           WHERE dated_membership.student_id = student.id
             AND dated_membership.enrolled_at <= $2
             AND (dated_membership.ended_at IS NULL OR dated_membership.ended_at > $2)
         )
         AND COALESCE(
           (
             SELECT transfer.to_group_id
             FROM academy_student_transfers transfer
             WHERE transfer.student_id = student.id
               AND transfer.created_at <= $2
             ORDER BY transfer.created_at DESC, transfer.id DESC
             LIMIT 1
           ),
           (
             SELECT first_transfer.from_group_id
             FROM academy_student_transfers first_transfer
             WHERE first_transfer.student_id = student.id
             ORDER BY first_transfer.created_at, first_transfer.id
             LIMIT 1
           ),
           student.group_id
         ) = $1
       )
     )
     AND COALESCE(
       (
         SELECT history.to_status
         FROM academy_student_status_history history
         WHERE history.student_id = student.id
           AND history.created_at <= $2
         ORDER BY history.created_at DESC, history.id DESC
         LIMIT 1
       ),
       'studying'
     ) = 'studying'
   ORDER BY student.id
   ${lock ? 'FOR UPDATE OF student' : ''}`,
  [groupId, scheduledAt],
);
