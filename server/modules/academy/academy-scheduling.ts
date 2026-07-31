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
  ACADEMY_TIME_ZONE,
  Row,
  parseTimeToMinutes,
  query,
  queryOne,
  updateRow,
} from './academy-core';

export const calendarDayOrdinal = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day);

export const getAcademySlotPosition = (date: Date, durationMinutes = 0) => {
  const parts = getZonedDateTimeParts(date, ACADEMY_TIME_ZONE);
  const nativeDay = new Date(calendarDayOrdinal(parts.year, parts.month, parts.day)).getUTCDay();
  const startMinutes = parts.hour * 60 + parts.minute;
  return {
    dayOfWeek: nativeDay === 0 ? 7 : nativeDay,
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
  };
};

export const academyDayOfWeek = (date: Date) => getAcademySlotPosition(date).dayOfWeek;

export type NormalizedScheduleItem = NormalizedWeeklyScheduleItem;

export const readJsonArray = (value: unknown): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const normalizeScheduleItems = normalizeWeeklySchedule;
export const intervalsOverlap = scheduleIntervalsOverlap;

export const dateOnlyDayOrdinal = (date: Date) => calendarDayOrdinal(
  date.getUTCFullYear(),
  date.getUTCMonth() + 1,
  date.getUTCDate(),
);

export const academyDayOrdinal = (date: Date) => {
  const parts = getZonedDateTimeParts(date, ACADEMY_TIME_ZONE);
  return calendarDayOrdinal(parts.year, parts.month, parts.day);
};

export const dateRangesOverlap = (
  leftStart?: Date | null,
  leftEnd?: Date | null,
  rightStart?: Date | null,
  rightEnd?: Date | null,
) => {
  if (
    (leftStart && Number.isNaN(leftStart.getTime()))
    || (leftEnd && Number.isNaN(leftEnd.getTime()))
    || (rightStart && Number.isNaN(rightStart.getTime()))
    || (rightEnd && Number.isNaN(rightEnd.getTime()))
  ) return false;
  const leftStartDay = leftStart ? dateOnlyDayOrdinal(leftStart) : Number.NEGATIVE_INFINITY;
  const leftEndDay = leftEnd ? dateOnlyDayOrdinal(leftEnd) : Number.POSITIVE_INFINITY;
  const rightStartDay = rightStart ? dateOnlyDayOrdinal(rightStart) : Number.NEGATIVE_INFINITY;
  const rightEndDay = rightEnd ? dateOnlyDayOrdinal(rightEnd) : Number.POSITIVE_INFINITY;
  return leftStartDay <= rightEndDay && leftEndDay >= rightStartDay;
};

export const isDateInsideInclusiveDayRange = (
  value: Date,
  start?: Date | null,
  end?: Date | null,
) => {
  if (
    Number.isNaN(value.getTime())
    || (start && Number.isNaN(start.getTime()))
    || (end && Number.isNaN(end.getTime()))
  ) return false;
  const day = academyDayOrdinal(value);
  return day >= (start ? dateOnlyDayOrdinal(start) : Number.NEGATIVE_INFINITY)
    && day <= (end ? dateOnlyDayOrdinal(end) : Number.POSITIVE_INFINITY);
};

export const parseDateOnly = (value: unknown) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const marker = new Date(calendarDayOrdinal(year, month, day));
  if (
    marker.getUTCFullYear() !== year
    || marker.getUTCMonth() + 1 !== month
    || marker.getUTCDate() !== day
  ) return null;
  return zonedWallClockToInstant({ year, month, day }, ACADEMY_TIME_ZONE);
};

export type ReportingRange = {
  start: Date;
  end: Date;
  from: string;
  to: string;
};

export const parseReportingRange = (fromValue: unknown, toValue: unknown): ReportingRange | null => {
  if (fromValue === undefined && toValue === undefined) return null;
  const from = String(fromValue ?? '');
  const to = String(toValue ?? '');
  const start = parseDateOnly(from);
  const inclusiveEnd = parseDateOnly(to);
  if (!start || !inclusiveEnd) {
    throw Object.assign(new Error('invalidReportingPeriod'), { statusCode: 400 });
  }
  const end = getZonedDayRange(inclusiveEnd, ACADEMY_TIME_ZONE).end;
  if (end <= start) {
    throw Object.assign(new Error('invalidReportingPeriod'), { statusCode: 400 });
  }
  const totalDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1_000));
  if (totalDays > 731) {
    throw Object.assign(new Error('reportingPeriodTooLong'), { statusCode: 400 });
  }
  return { start, end, from, to };
};

export const academyDateOnlyKey = (value: Date) => {
  const parts = getZonedDateTimeParts(value, ACADEMY_TIME_ZONE);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

export const reportingBuckets = (range: ReportingRange) => {
  const dayMs = 24 * 60 * 60 * 1_000;
  const totalDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / dayMs));
  const stepDays = totalDays <= 14 ? 1 : totalDays <= 70 ? 7 : Math.ceil(totalDays / 12);
  const result: Array<{ start: Date; end: Date; periodStart: string }> = [];
  for (let cursor = range.start.getTime(); cursor < range.end.getTime(); cursor += stepDays * dayMs) {
    const start = new Date(cursor);
    result.push({
      start,
      end: new Date(Math.min(cursor + stepDays * dayMs, range.end.getTime())),
      periodStart: academyDateOnlyKey(start),
    });
  }
  return result;
};

export const startOfAcademyDay = (date: Date) =>
  getZonedDayRange(date, ACADEMY_TIME_ZONE).start;

export const scheduleCoversSlot = (
  schedule: NormalizedScheduleItem[],
  dayOfWeek: number,
  startMinutes: number,
  endMinutes: number,
  schoolId?: number | null,
) => schedule.some((item) =>
  item.dayOfWeek === dayOfWeek
  && (!schoolId || !item.schoolId || item.schoolId === Number(schoolId))
  && startMinutes >= item.startMinutes
  && endMinutes <= item.endMinutes
);

export const scheduleConflictsWithSlot = (
  schedule: NormalizedScheduleItem[],
  dayOfWeek: number,
  startMinutes: number,
  endMinutes: number,
) => schedule.some((item) =>
  item.dayOfWeek === dayOfWeek
  && intervalsOverlap(startMinutes, endMinutes, item.startMinutes, item.endMinutes)
);

export const getTeacherAvailability = (teacher: Row, durationMinutes: number) =>
  normalizeScheduleItems(
    readJsonArray(teacher.availability).length > 0 ? teacher.availability : teacher.schedule,
    durationMinutes,
  );

export const findAvailableTeacher = async (options: {
  courseId: number;
  schoolId?: number | null;
  scheduledAt: Date;
  durationMinutes: number;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
  excludeDemoLessonId?: number | null;
}) => {
  const candidates = await query(
    `SELECT t.*,
        (
          SELECT COUNT(*)::int
          FROM academy_lessons l
          WHERE l.teacher_id = t.id
            AND l.status = 'scheduled'
            AND l.scheduled_at >= NOW()
        ) AS upcoming_lessons
     FROM academy_teachers t
     WHERE t.status = 'active'
       AND t.course_ids @> $1::jsonb
     ORDER BY upcoming_lessons, t.id`,
    [JSON.stringify([options.courseId])],
  );

  const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
    options.scheduledAt,
    options.durationMinutes,
  );
  const lessonEnd = addMinutes(options.scheduledAt, options.durationMinutes);
  const teacherIds = candidates.map((teacher) => Number(teacher.id));
  const existingGroups = teacherIds.length > 0
    ? await query(
      `SELECT * FROM academy_groups
       WHERE teacher_id = ANY($1::int[])
         AND status IN ('open', 'in_progress')
         AND ($2::int IS NULL OR id <> $2)`,
      [teacherIds, options.excludeGroupId ?? null],
    )
    : [];

  for (const teacher of candidates) {
    const schoolIds = Array.isArray(teacher.schoolIds) ? teacher.schoolIds.map(Number) : [];
    if (options.schoolId && schoolIds.length > 0 && !schoolIds.includes(Number(options.schoolId))) {
      continue;
    }

    const availability = Array.isArray(teacher.availability)
      ? teacher.availability
      : Array.isArray(teacher.schedule)
        ? teacher.schedule
        : [];
    const canWork = availability.some((item: Row) => {
      if (Number(item.dayOfWeek) !== dayOfWeek) return false;
      if (options.schoolId && item.schoolId && Number(item.schoolId) !== Number(options.schoolId)) return false;
      const availableStart = parseTimeToMinutes(item.startTime ?? item.time);
      const availableEnd = parseTimeToMinutes(item.endTime ?? item.time);
      if (availableStart === null) return false;
      const resolvedEnd = availableEnd === null || availableEnd === availableStart
        ? availableStart + options.durationMinutes
        : availableEnd;
      return startMinutes >= availableStart && endMinutes <= resolvedEnd;
    });
    if (!canWork) continue;

    const groupConflict = existingGroups
      .filter((group) => Number(group.teacherId) === Number(teacher.id))
      .some((group) =>
        isDateInsideInclusiveDayRange(
          options.scheduledAt,
          group.startDate ? new Date(group.startDate) : null,
          group.endDate ? new Date(group.endDate) : null,
        )
        && scheduleConflictsWithSlot(
          normalizeScheduleItems(group.schedule),
          dayOfWeek,
          startMinutes,
          endMinutes,
        )
      );
    if (groupConflict) continue;

    const [lessonConflict, demoConflict] = await Promise.all([
      queryOne(
        `SELECT id
         FROM academy_lessons
         WHERE teacher_id = $1
           AND status <> 'cancelled'
           AND scheduled_at < $3
           AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
           AND ($4::int IS NULL OR id <> $4)
         LIMIT 1`,
        [teacher.id, options.scheduledAt, lessonEnd, options.excludeLessonId ?? null],
      ),
      queryOne(
        `SELECT id
         FROM academy_demo_lessons
         WHERE teacher_id = $1
           AND status = 'scheduled'
           AND scheduled_at < $3
           AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
           AND ($4::int IS NULL OR id <> $4)
         LIMIT 1`,
        [teacher.id, options.scheduledAt, lessonEnd, options.excludeDemoLessonId ?? null],
      ),
    ]);
    if (!lessonConflict && !demoConflict) return teacher;
  }

  return null;
};

export const findTeacherForGroupSchedule = async (options: {
  courseId: number;
  schoolId: number;
  schedule: unknown;
  startDate?: Date | null;
  endDate?: Date | null;
  excludeGroupId?: number | null;
}) => {
  const requestedSchedule = normalizeScheduleItems(options.schedule);
  if (requestedSchedule.length === 0) return null;

  const candidates = await query(
    `SELECT t.*,
        (SELECT COUNT(*)::int FROM academy_groups g
         WHERE g.teacher_id = t.id AND g.status IN ('open', 'in_progress')) AS active_groups
     FROM academy_teachers t
     WHERE t.status = 'active'
     ORDER BY active_groups, t.id`,
  );

  const teacherIds = candidates.map((teacher) => Number(teacher.id));
  const existingGroups = teacherIds.length > 0
    ? await query(
      `SELECT * FROM academy_groups
       WHERE status IN ('open', 'in_progress')
         AND teacher_id = ANY($1::int[])
         AND ($2::int IS NULL OR id <> $2)`,
      [teacherIds, options.excludeGroupId ?? null],
    )
    : [];
  const rangeStart = options.startDate
    ? getZonedDateOnlyRange(options.startDate, ACADEMY_TIME_ZONE).start
    : startOfAcademyDay(new Date());
  const rangeEnd = options.endDate
    ? getZonedDateOnlyRange(options.endDate, ACADEMY_TIME_ZONE).end
    : null;
  const [existingLessons, existingDemos] = teacherIds.length > 0
    ? await Promise.all([query(
      `SELECT teacher_id, scheduled_at, duration_minutes
       FROM academy_lessons
       WHERE teacher_id = ANY($1::int[])
         AND status <> 'cancelled'
         AND scheduled_at >= $2
         AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
      [teacherIds, rangeStart, rangeEnd],
    ), query(
      `SELECT teacher_id, scheduled_at, duration_minutes
       FROM academy_demo_lessons
       WHERE teacher_id = ANY($1::int[])
         AND status = 'scheduled'
         AND scheduled_at >= $2
         AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
      [teacherIds, rangeStart, rangeEnd],
    )])
    : [[], []];

  for (const teacher of candidates) {
    const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
    if (schoolIds.length > 0 && !schoolIds.includes(options.schoolId)) continue;
    const availability = getTeacherAvailability(teacher, 60);
    const coversSchedule = requestedSchedule.every((item) =>
      scheduleCoversSlot(
        availability,
        item.dayOfWeek,
        item.startMinutes,
        item.endMinutes,
        options.schoolId,
      )
    );
    if (!coversSchedule) continue;

    const hasRecurringConflict = existingGroups
      .filter((group) => Number(group.teacherId) === Number(teacher.id))
      .some((group) => {
        if (!dateRangesOverlap(
          options.startDate,
          options.endDate,
          group.startDate ? new Date(group.startDate) : null,
          group.endDate ? new Date(group.endDate) : null,
        )) return false;
        const groupSchedule = normalizeScheduleItems(group.schedule);
        return requestedSchedule.some((item) =>
          scheduleConflictsWithSlot(
            groupSchedule,
            item.dayOfWeek,
            item.startMinutes,
            item.endMinutes,
          )
        );
      });
    if (hasRecurringConflict) continue;

    const hasLessonConflict = existingLessons
      .filter((lesson) => Number(lesson.teacherId) === Number(teacher.id))
      .some((lesson) => {
        const scheduledAt = new Date(lesson.scheduledAt);
        const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
          scheduledAt,
          Number(lesson.durationMinutes || 60),
        );
        return requestedSchedule.some((item) =>
          item.dayOfWeek === dayOfWeek
          && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
        );
      });
    const hasDemoConflict = existingDemos
      .filter((demo) => Number(demo.teacherId) === Number(teacher.id))
      .some((demo) => {
        const scheduledAt = new Date(demo.scheduledAt);
        const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
          scheduledAt,
          Number(demo.durationMinutes || 60),
        );
        return requestedSchedule.some((item) =>
          item.dayOfWeek === dayOfWeek
          && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
        );
      });
    if (!hasLessonConflict && !hasDemoConflict) return teacher;
  }

  return null;
};

export const ensureTeacherCourseAssignment = async (teacher: Row, courseId: number) => {
  const currentCourseIds = readJsonArray(teacher.courseIds)
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0);
  if (currentCourseIds.includes(courseId)) return;

  const nextCourseIds = [...new Set([...currentCourseIds, courseId])]
    .sort((left, right) => left - right);
  await updateRow('academy_teachers', Number(teacher.id), { courseIds: nextCourseIds });
};

export const assertTeacherCanLeadGroupSchedule = async (options: {
  teacherId: number;
  courseId: number;
  schoolId: number;
  schedule: unknown;
  startDate?: Date | null;
  endDate?: Date | null;
  excludeGroupId?: number | null;
}) => {
  const teacher = await queryOne(`SELECT * FROM academy_teachers WHERE id = $1`, [options.teacherId]);
  if (!teacher) {
    throw Object.assign(new Error('teacherNotFound'), { statusCode: 404 });
  }
  if (teacher.status !== 'active') {
    throw Object.assign(new Error('teacherNotActive'), { statusCode: 400 });
  }

  const requestedSchedule = normalizeScheduleItems(options.schedule);
  const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
  if (schoolIds.length > 0 && !schoolIds.includes(options.schoolId)) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  const availability = getTeacherAvailability(teacher, 60);
  const coversSchedule = requestedSchedule.every((item) =>
    scheduleCoversSlot(
      availability,
      item.dayOfWeek,
      item.startMinutes,
      item.endMinutes,
      options.schoolId,
    )
  );
  if (!coversSchedule) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  const existingGroups = await query(
    `SELECT *
     FROM academy_groups
     WHERE teacher_id = $1
       AND status IN ('open', 'in_progress')
       AND ($2::int IS NULL OR id <> $2)`,
    [options.teacherId, options.excludeGroupId ?? null],
  );
  const recurringConflict = existingGroups.some((group) => {
    if (!dateRangesOverlap(
      options.startDate,
      options.endDate,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )) return false;
    return weeklySchedulesOverlap(requestedSchedule, normalizeScheduleItems(group.schedule));
  });
  if (recurringConflict) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  const rangeStart = options.startDate
    ? getZonedDateOnlyRange(options.startDate, ACADEMY_TIME_ZONE).start
    : startOfAcademyDay(new Date());
  const rangeEnd = options.endDate
    ? getZonedDateOnlyRange(options.endDate, ACADEMY_TIME_ZONE).end
    : null;
  const [existingLessons, existingDemos] = await Promise.all([
    query(
      `SELECT scheduled_at, duration_minutes
       FROM academy_lessons
       WHERE teacher_id = $1
         AND status <> 'cancelled'
         AND scheduled_at >= $2
         AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
      [options.teacherId, rangeStart, rangeEnd],
    ),
    query(
      `SELECT scheduled_at, duration_minutes
       FROM academy_demo_lessons
       WHERE teacher_id = $1
         AND status = 'scheduled'
         AND scheduled_at >= $2
         AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
      [options.teacherId, rangeStart, rangeEnd],
    ),
  ]);
  const scheduledConflict = [...existingLessons, ...existingDemos].some((lesson) => {
    const scheduledAt = new Date(lesson.scheduledAt);
    const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
      scheduledAt,
      Number(lesson.durationMinutes || 60),
    );
    return requestedSchedule.some((item) =>
      item.dayOfWeek === dayOfWeek
      && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
    );
  });
  if (scheduledConflict) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  await ensureTeacherCourseAssignment(teacher, options.courseId);
  return teacher;
};

export const assertTeacherCanLeadLesson = async (options: {
  teacherId: number;
  courseId: number;
  schoolId: number;
  scheduledAt: Date;
  durationMinutes: number;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
  excludeDemoLessonId?: number | null;
}) => {
  const teacher = await queryOne(`SELECT * FROM academy_teachers WHERE id = $1`, [options.teacherId]);
  if (!teacher) throw Object.assign(new Error('teacherNotFound'), { statusCode: 404 });
  if (teacher.status !== 'active') {
    throw Object.assign(new Error('teacherNotActive'), { statusCode: 400 });
  }

  const courseIds = readJsonArray(teacher.courseIds).map(Number);
  const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
  if (
    (courseIds.length > 0 && !courseIds.includes(options.courseId))
    || (schoolIds.length > 0 && !schoolIds.includes(options.schoolId))
  ) {
    throw Object.assign(new Error('teacherUnavailableForLesson'), { statusCode: 409 });
  }

  const startsAt = new Date(options.scheduledAt);
  const endsAt = addMinutes(startsAt, options.durationMinutes);
  const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
    startsAt,
    options.durationMinutes,
  );
  if (!scheduleCoversSlot(
    getTeacherAvailability(teacher, options.durationMinutes),
    dayOfWeek,
    startMinutes,
    endMinutes,
    options.schoolId,
  )) {
    throw Object.assign(new Error('teacherUnavailableForLesson'), { statusCode: 409 });
  }

  const [lessonConflict, demoConflict, groups] = await Promise.all([
    queryOne(
      `SELECT id
       FROM academy_lessons
       WHERE teacher_id = $1
         AND status <> 'cancelled'
         AND scheduled_at < $3
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR id <> $4)
       LIMIT 1`,
      [options.teacherId, startsAt, endsAt, options.excludeLessonId ?? null],
    ),
    queryOne(
      `SELECT id
       FROM academy_demo_lessons
       WHERE teacher_id = $1
         AND status = 'scheduled'
         AND scheduled_at < $3
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR id <> $4)
       LIMIT 1`,
      [options.teacherId, startsAt, endsAt, options.excludeDemoLessonId ?? null],
    ),
    query(
      `SELECT *
       FROM academy_groups
       WHERE teacher_id = $1
         AND status IN ('open', 'in_progress')
         AND ($2::int IS NULL OR id <> $2)`,
      [options.teacherId, options.excludeGroupId ?? null],
    ),
  ]);
  const recurringConflict = groups.some((group) =>
    isDateInsideInclusiveDayRange(
      startsAt,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )
    && scheduleConflictsWithSlot(
      normalizeScheduleItems(group.schedule),
      dayOfWeek,
      startMinutes,
      endMinutes,
    )
  );
  if (lessonConflict || demoConflict || recurringConflict) {
    throw Object.assign(new Error('teacherUnavailableForLesson'), { statusCode: 409 });
  }
  await ensureTeacherCourseAssignment(teacher, options.courseId);
  return teacher;
};

export const assertActiveRoomInSchool = async (roomId: number, schoolId: number) => {
  const room = await queryOne(
    `SELECT room.*
     FROM academy_rooms room
     JOIN academy_schools school ON school.id = room.school_id AND school.is_active = true
     WHERE room.id = $1 AND room.school_id = $2 AND room.is_active = true`,
    [roomId, schoolId],
  );
  if (!room) throw Object.assign(new Error('roomNotFound'), { statusCode: 404 });
  return room;
};

export const assertRoomScheduleAvailable = async (options: {
  schoolId: number;
  roomId: number;
  schedule: unknown;
  startDate?: Date | null;
  endDate?: Date | null;
  excludeGroupId?: number | null;
}) => {
  await assertActiveRoomInSchool(options.roomId, options.schoolId);
  const validationError = getGroupScheduleValidationError(options.schedule);
  if (validationError) {
    throw Object.assign(new Error(validationError), {
      statusCode: validationError === 'groupScheduleRequired' || validationError === 'groupScheduleInvalid'
        ? 400
        : 409,
    });
  }

  const requestedSchedule = normalizeScheduleItems(options.schedule);

  const existingGroups = await query(
    `SELECT * FROM academy_groups
     WHERE room_id = $1
       AND status IN ('open', 'in_progress')
       AND ($2::int IS NULL OR id <> $2)`,
    [options.roomId, options.excludeGroupId ?? null],
  );

  const recurringConflict = existingGroups.some((group) => {
    if (!dateRangesOverlap(
      options.startDate,
      options.endDate,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )) return false;
    return weeklySchedulesOverlap(requestedSchedule, normalizeScheduleItems(group.schedule));
  });
  if (recurringConflict) {
    throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
  }

  const rangeStart = options.startDate
    ? getZonedDateOnlyRange(options.startDate, ACADEMY_TIME_ZONE).start
    : startOfAcademyDay(new Date());
  const rangeEnd = options.endDate
    ? getZonedDateOnlyRange(options.endDate, ACADEMY_TIME_ZONE).end
    : null;
  const [lessons, demos] = await Promise.all([
    query(
      `SELECT scheduled_at, duration_minutes
       FROM academy_lessons
       WHERE room_id = $1
         AND status <> 'cancelled'
         AND scheduled_at >= $2
         AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
      [options.roomId, rangeStart, rangeEnd],
    ),
    query(
      `SELECT scheduled_at, duration_minutes
       FROM academy_demo_lessons
       WHERE room_id = $1
         AND status = 'scheduled'
         AND scheduled_at >= $2
         AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
      [options.roomId, rangeStart, rangeEnd],
    ),
  ]);
  const lessonConflict = [...lessons, ...demos].some((lesson) => {
    const scheduledAt = new Date(lesson.scheduledAt);
    const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
      scheduledAt,
      Number(lesson.durationMinutes || 60),
    );
    return requestedSchedule.some((item) =>
      item.dayOfWeek === dayOfWeek
      && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
    );
  });
  if (lessonConflict) {
    throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
  }
};

export const assertLessonRoomAvailable = async (options: {
  schoolId: number;
  roomId: number;
  scheduledAt: Date;
  durationMinutes: number;
  excludeLessonId?: number | null;
  excludeGroupId?: number | null;
  excludeDemoLessonId?: number | null;
}) => {
  await assertActiveRoomInSchool(options.roomId, options.schoolId);
  const startsAt = new Date(options.scheduledAt);
  const endsAt = addMinutes(startsAt, options.durationMinutes);
  const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
    startsAt,
    options.durationMinutes,
  );

  const [lessonConflict, demoConflict, groupLessonConflict, groups] = await Promise.all([
    queryOne(
      `SELECT id FROM academy_lessons
       WHERE room_id = $1
         AND status <> 'cancelled'
         AND scheduled_at < $3
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR id <> $4)
       LIMIT 1`,
      [options.roomId, startsAt, endsAt, options.excludeLessonId ?? null],
    ),
    queryOne(
      `SELECT id FROM academy_demo_lessons
       WHERE room_id = $1
         AND status = 'scheduled'
         AND scheduled_at < $3
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR id <> $4)
       LIMIT 1`,
      [options.roomId, startsAt, endsAt, options.excludeDemoLessonId ?? null],
    ),
    options.excludeGroupId
      ? queryOne(
        `SELECT id
         FROM academy_lessons
         WHERE group_id = $1
           AND status <> 'cancelled'
           AND scheduled_at < $3
           AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
           AND ($4::int IS NULL OR id <> $4)
         LIMIT 1`,
        [options.excludeGroupId, startsAt, endsAt, options.excludeLessonId ?? null],
      )
      : Promise.resolve(null),
    query(
      `SELECT * FROM academy_groups
       WHERE room_id = $1
         AND status IN ('open', 'in_progress')
         AND ($2::int IS NULL OR id <> $2)`,
      [options.roomId, options.excludeGroupId ?? null],
    ),
  ]);

  if (lessonConflict) throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
  if (demoConflict) throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
  if (groupLessonConflict) {
    throw Object.assign(new Error('groupLessonOverlap'), { statusCode: 409 });
  }

  const recurringConflict = groups.some((group) =>
    isDateInsideInclusiveDayRange(
      startsAt,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )
    && scheduleConflictsWithSlot(
      normalizeScheduleItems(group.schedule),
      dayOfWeek,
      startMinutes,
      endMinutes,
    )
  );
  if (recurringConflict) throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
};

export const listAvailableSchoolSlots = async (options: {
  schoolId: number;
  courseId: number;
  from: Date;
  days: number;
  format?: 'offline' | 'online';
  participantCount?: number;
  participantIds?: number[];
  excludeLeadId?: number | null;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
  excludeDemoLessonId?: number | null;
}) => {
  const course = await queryOne(`SELECT * FROM academy_courses WHERE id = $1 AND is_active = true`, [options.courseId]);
  if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });
  const school = await queryOne(`SELECT * FROM academy_schools WHERE id = $1 AND is_active = true`, [options.schoolId]);
  if (!school) throw Object.assign(new Error('School not found'), { statusCode: 404 });

  const durationMinutes = Math.max(15, Number(course.lessonDurationMinutes || 60));
  const format = options.format === 'online' ? 'online' : 'offline';
  const participantCount = Math.max(1, Number(options.participantCount) || 1);
  const rangeStart = startOfAcademyDay(options.from);
  const rangeEnd = getZonedDayRange(rangeStart, ACADEMY_TIME_ZONE, options.days).start;
  const [teachers, rooms] = await Promise.all([query(
    `SELECT t.*,
        (SELECT COUNT(*)::int FROM academy_lessons l
         WHERE l.teacher_id = t.id AND l.status = 'scheduled' AND l.scheduled_at >= NOW()) AS upcoming_lessons
     FROM academy_teachers t
     WHERE t.status = 'active'
       AND t.course_ids @> $1::jsonb
     ORDER BY upcoming_lessons, t.id`,
    [JSON.stringify([options.courseId])],
  ), format === 'offline'
    ? query(
      `SELECT * FROM academy_rooms
       WHERE school_id = $1 AND is_active = true AND capacity >= $2
       ORDER BY capacity, name, id`,
      [options.schoolId, participantCount],
    )
    : Promise.resolve([])]);
  const teacherIds = teachers.map((teacher) => Number(teacher.id));

  const [lessons, groups, demos, legacyDemos] = await Promise.all([
    query(
      `SELECT * FROM academy_lessons
       WHERE status <> 'cancelled'
         AND scheduled_at < $2
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $1
         AND (school_id = $3 OR teacher_id = ANY($4::int[]))
         AND ($5::int IS NULL OR id <> $5)`,
      [rangeStart, rangeEnd, options.schoolId, teacherIds, options.excludeLessonId ?? null],
    ),
    query(
      `SELECT * FROM academy_groups
       WHERE status IN ('open', 'in_progress')
         AND (school_id = $1 OR teacher_id = ANY($2::int[]))
         AND ($3::int IS NULL OR id <> $3)`,
      [options.schoolId, teacherIds, options.excludeGroupId ?? null],
    ),
    query(
      `SELECT demo.*,
          ARRAY(
            SELECT participant.lead_id
            FROM academy_demo_lesson_participants participant
            WHERE participant.demo_lesson_id = demo.id
              AND participant.status <> 'cancelled'
          ) AS participant_lead_ids
       FROM academy_demo_lessons demo
       WHERE status = 'scheduled'
         AND scheduled_at < $2
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $1
         AND (school_id = $3 OR teacher_id = ANY($4::int[]))
         AND ($5::int IS NULL OR id <> $5)`,
      [rangeStart, rangeEnd, options.schoolId, teacherIds, options.excludeDemoLessonId ?? null],
    ),
    query(
      `SELECT l.id, l.demo_at, l.demo_format,
              COALESCE(c.lesson_duration_minutes, $4)::int AS duration_minutes
       FROM academy_leads l
       LEFT JOIN academy_courses c ON c.id = COALESCE(l.demo_course_id, l.course_id)
       WHERE l.school_id = $1
         AND l.demo_at >= $2
         AND l.demo_at < $3
         AND COALESCE(l.demo_attended, false) = false
         AND l.status_code <> 'not_now'
         AND COALESCE(l.is_archived, false) = false
         AND NOT EXISTS (
           SELECT 1
           FROM academy_demo_lesson_participants participant
           JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
           WHERE participant.lead_id = l.id
             AND demo.status = 'scheduled'
             AND demo.scheduled_at = l.demo_at
         )
         AND ($5::int IS NULL OR l.id <> $5)`,
      [options.schoolId, rangeStart, rangeEnd, durationMinutes, options.excludeLeadId ?? null],
    ),
  ]);

  type AvailableSlot = Row & {
    teacherIds: Set<number>;
    roomIds: Set<number>;
    optionKeys: Set<string>;
  };
  const slots = new Map<number, AvailableSlot>();
  const now = new Date();

  for (let offset = 0; offset < options.days; offset += 1) {
    const date = getZonedDayRange(rangeStart, ACADEMY_TIME_ZONE, offset).start;
    const dateParts = getZonedDateTimeParts(date, ACADEMY_TIME_ZONE);
    const dayOfWeek = academyDayOfWeek(date);

    for (const teacher of teachers) {
      const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
      if (schoolIds.length > 0 && !schoolIds.includes(options.schoolId)) continue;
      const availability = getTeacherAvailability(teacher, durationMinutes)
        .filter((item) => item.dayOfWeek === dayOfWeek
          && (!item.schoolId || item.schoolId === options.schoolId));

      for (const window of availability) {
        for (
          let startMinutes = window.startMinutes;
          startMinutes + durationMinutes <= window.endMinutes;
          startMinutes += 30
        ) {
          const startsAt = zonedWallClockToInstant({
            year: dateParts.year,
            month: dateParts.month,
            day: dateParts.day,
            hour: Math.floor(startMinutes / 60),
            minute: startMinutes % 60,
          }, ACADEMY_TIME_ZONE);
          if (startsAt.getTime() <= now.getTime()) continue;
          const endsAt = addMinutes(startsAt, durationMinutes);
          const slotKey = startsAt.getTime();

          const teacherBusyByLesson = lessons.some((lesson) => {
            if (Number(lesson.teacherId) !== Number(teacher.id)) return false;
            const lessonStart = new Date(lesson.scheduledAt);
            const lessonEnd = addMinutes(lessonStart, Number(lesson.durationMinutes || 60));
            return startsAt < lessonEnd && endsAt > lessonStart;
          });
          const teacherBusyByGroup = groups.some((group) => {
            if (Number(group.teacherId) !== Number(teacher.id)) return false;
            if (!isDateInsideInclusiveDayRange(
              startsAt,
              group.startDate ? new Date(group.startDate) : null,
              group.endDate ? new Date(group.endDate) : null,
            )) return false;
            return scheduleConflictsWithSlot(
              normalizeScheduleItems(group.schedule),
              dayOfWeek,
              startMinutes,
              startMinutes + durationMinutes,
            );
          });
          const teacherBusyByDemo = demos.some((demo) => {
            if (Number(demo.teacherId) !== Number(teacher.id)) return false;
            const demoStart = new Date(demo.scheduledAt);
            const demoEnd = addMinutes(demoStart, Number(demo.durationMinutes || durationMinutes));
            return startsAt < demoEnd && endsAt > demoStart;
          });
          const participantBusyByDemo = demos.some((demo) => {
            const participantLeadIds = Array.isArray(demo.participantLeadIds)
              ? demo.participantLeadIds.map(Number)
              : [];
            if (!(options.participantIds ?? []).some((leadId) => participantLeadIds.includes(leadId))) return false;
            const demoStart = new Date(demo.scheduledAt);
            const demoEnd = addMinutes(demoStart, Number(demo.durationMinutes || durationMinutes));
            return startsAt < demoEnd && endsAt > demoStart;
          });
          const participantBusyByLegacyDemo = legacyDemos.some((demo) => {
            if (!(options.participantIds ?? []).includes(Number(demo.id))) return false;
            const demoStart = new Date(demo.demoAt);
            const demoEnd = addMinutes(demoStart, Number(demo.durationMinutes || durationMinutes));
            return startsAt < demoEnd && endsAt > demoStart;
          });
          if (
            teacherBusyByLesson
            || teacherBusyByGroup
            || teacherBusyByDemo
            || participantBusyByDemo
            || participantBusyByLegacyDemo
          ) continue;

          const candidateRooms = format === 'online' ? [null] : rooms;
          for (const room of candidateRooms) {
            const roomId = room ? Number(room.id) : null;
            const roomBusyByLesson = roomId !== null && lessons.some((lesson) => {
              if (Number(lesson.roomId) !== roomId) return false;
              const lessonStart = new Date(lesson.scheduledAt);
              const lessonEnd = addMinutes(lessonStart, Number(lesson.durationMinutes || 60));
              return startsAt < lessonEnd && endsAt > lessonStart;
            });
            const roomBusyByDemo = roomId !== null && demos.some((demo) => {
              if (Number(demo.roomId) !== roomId) return false;
              const demoStart = new Date(demo.scheduledAt);
              const demoEnd = addMinutes(demoStart, Number(demo.durationMinutes || durationMinutes));
              return startsAt < demoEnd && endsAt > demoStart;
            });
            const roomBusyByLegacyDemo = roomId !== null && legacyDemos.some((demo) => {
              if (demo.demoFormat === 'online') return false;
              const demoStart = new Date(demo.demoAt);
              const demoEnd = addMinutes(demoStart, Number(demo.durationMinutes || durationMinutes));
              return startsAt < demoEnd && endsAt > demoStart;
            });
            const roomBusyByGroup = roomId !== null && groups.some((group) => {
              if (Number(group.roomId) !== roomId) return false;
              if (!isDateInsideInclusiveDayRange(
                startsAt,
                group.startDate ? new Date(group.startDate) : null,
                group.endDate ? new Date(group.endDate) : null,
              )) return false;
              return scheduleConflictsWithSlot(
                normalizeScheduleItems(group.schedule),
                dayOfWeek,
                startMinutes,
                startMinutes + durationMinutes,
              );
            });
            if (roomBusyByLesson || roomBusyByDemo || roomBusyByLegacyDemo || roomBusyByGroup) continue;

            const optionKey = `${teacher.id}:${roomId ?? 'online'}`;
            const existing = slots.get(slotKey);
            if (existing) {
              if (existing.optionKeys.has(optionKey)) continue;
              existing.optionKeys.add(optionKey);
              existing.teacherIds.add(Number(teacher.id));
              if (roomId) existing.roomIds.add(roomId);
              existing.availableTeacherCount = existing.teacherIds.size;
              existing.availableRoomCount = format === 'online' ? 0 : existing.roomIds.size;
              existing.availableOptionCount = existing.optionKeys.size;
            } else {
              slots.set(slotKey, {
                startsAt: startsAt.toISOString(),
                endsAt: endsAt.toISOString(),
                teacherId: Number(teacher.id),
                teacherName: teacher.fullName,
                roomId,
                roomName: room?.name ?? null,
                roomCapacity: room ? Number(room.capacity) : null,
                availableTeacherCount: 1,
                availableRoomCount: roomId ? 1 : 0,
                availableOptionCount: 1,
                teacherIds: new Set([Number(teacher.id)]),
                roomIds: roomId ? new Set([roomId]) : new Set(),
                optionKeys: new Set([optionKey]),
              });
            }
          }
        }
      }
    }
  }

  return {
    school: { id: Number(school.id), name: school.name },
    course: { id: Number(course.id), name: course.name },
    durationMinutes,
    from: rangeStart.toISOString(),
    days: options.days,
    format,
    slots: [...slots.values()]
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
      .slice(0, 250)
      .map(({ teacherIds: _teacherIds, roomIds: _roomIds, optionKeys: _optionKeys, ...slot }) => slot),
  };
};

export const assertBookableOfflineSlot = async (options: {
  schoolId: number;
  courseId: number;
  startsAt: Date;
  excludeLeadId?: number | null;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
  excludeDemoLessonId?: number | null;
}) => {
  const result = await listAvailableSchoolSlots({
    schoolId: options.schoolId,
    courseId: options.courseId,
    from: startOfAcademyDay(options.startsAt),
    days: 1,
    excludeLeadId: options.excludeLeadId,
    excludeGroupId: options.excludeGroupId,
    excludeLessonId: options.excludeLessonId,
    excludeDemoLessonId: options.excludeDemoLessonId,
  });
  const selected = result.slots.find((slot) =>
    new Date(slot.startsAt).getTime() === options.startsAt.getTime()
  );
  if (!selected) {
    throw Object.assign(new Error('slotUnavailable'), { statusCode: 409 });
  }
  return selected;
};

// Template source prefixes from TZ 1.2: the suffix is filled from campaign/referrer name.
export const TEMPLATE_SOURCE_PREFIXES = ['instagram_ad', 'blogger', 'school', 'event', 'referral'];
