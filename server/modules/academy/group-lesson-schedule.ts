import { normalizeWeeklySchedule } from '@shared/scheduling';
import { getZonedDateOnlyRange, getZonedDateTimeParts } from '../../lib/academy-time';
import { buildFollowingRecurringLessonSchedule, type CalendarDate } from '../../lib/lesson-schedule';
import { ACADEMY_TIME_ZONE, insertRow, nullableText, query, queryOne, updateRow, type Row } from './academy-core';
import { hasProtectedLearningContent } from './course-curriculum';

export const calendarDateFromDateOnly = (value: Date): CalendarDate => ({
  year: value.getUTCFullYear(),
  month: value.getUTCMonth() + 1,
  day: value.getUTCDate(),
});

export const calendarDateFromInstant = (value: Date): CalendarDate => {
  const parts = getZonedDateTimeParts(value, ACADEMY_TIME_ZONE);
  return { year: parts.year, month: parts.month, day: parts.day };
};

export const calendarDateToUtcMarker = (value: CalendarDate) =>
  new Date(Date.UTC(value.year, value.month - 1, value.day));

export const normalizedGroupScheduleForComparison = (value: unknown) =>
  normalizeWeeklySchedule(value)
    .map((item) => ({
      dayOfWeek: item.dayOfWeek,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      schoolId: item.schoolId,
    }))
    .sort((left, right) =>
      left.dayOfWeek - right.dayOfWeek
      || left.startMinutes - right.startMinutes
      || left.endMinutes - right.endMinutes
      || Number(left.schoolId ?? 0) - Number(right.schoolId ?? 0));

export const groupLessonBackedFieldChanged = (field: string, nextValue: unknown, previousValue: unknown) => {
  if (field === 'selectedCourseLessonIds') return JSON.stringify(nextValue ?? null) !== JSON.stringify(previousValue ?? null);
  if (field === 'schedule') {
    return JSON.stringify(normalizedGroupScheduleForComparison(nextValue))
      !== JSON.stringify(normalizedGroupScheduleForComparison(previousValue));
  }
  if (field === 'startDate' || field === 'endDate') {
    const calendarDay = (value: unknown) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = new Date(value as string | number | Date);
      if (Number.isNaN(parsed.getTime())) return null;
      const { year, month, day } = getZonedDateTimeParts(parsed, ACADEMY_TIME_ZONE);
      return `${year}-${month}-${day}`;
    };
    return calendarDay(nextValue) !== calendarDay(previousValue);
  }
  if (field === 'frequency') {
    return nullableText(nextValue) !== nullableText(previousValue);
  }
  if (field === 'roomId' || field === 'teacherId') {
    const id = (value: unknown) => Number(value) || null;
    return id(nextValue) !== id(previousValue);
  }
  return Number(nextValue) !== Number(previousValue);
};

type PrepareLesson = (options: { values: Row; oldRow?: Row; excludeLessonId?: number; excludeLessonIds?: number[] }) => Promise<void>;

const running = (group: Row) => group.isArchived !== true && ['open', 'in_progress'].includes(String(group.status));
const sameId = (left: unknown, right: unknown) => (Number(left) || null) === (Number(right) || null);
const readProgram = (value: unknown): Row[] => {
  let program = value;
  if (typeof program === 'string') {
    try { program = JSON.parse(program); } catch { program = []; }
  }
  return Array.isArray(program) ? program as Row[] : [];
};

/**
 * A changed timetable, teacher, room or lesson count reaches the lessons nobody
 * has marked yet. Conducted, cancelled, past and marked lessons keep their
 * time, teacher and room as history. A running group's future lessons move to
 * the new timetable at once; a frozen or archived group (or one restored in the
 * same save) takes the new teacher and room now and its new times from
 * restoreArchivedGroupLessons, which checks them against the new ones.
 */
export async function reconcileGroupScheduleLessons(
  group: Row,
  previous: Row,
  prepareLesson: PrepareLesson,
  actorId: number | null,
  reference = new Date(),
) {
  const changed = (field: string) => groupLessonBackedFieldChanged(field, group[field], previous[field]);
  const timesFollow = running(group) && running(previous);
  // A one-off reschedule stays unless the timetable itself or the start changes.
  const timetableChanged = timesFollow && (changed('schedule') || changed('startDate'));
  const teacherChanged = changed('teacherId');
  const roomChanged = changed('roomId');
  // A selected curriculum decides its own lessons (reconcileGroupCourseLessons),
  // and a count that was never set is not a request to add or cancel lessons.
  const countChanged = timesFollow && group.selectedCourseLessonIds == null
    && Number(previous.lessonCount) > 0 && changed('lessonCount');
  if (!timetableChanged && !teacherChanged && !roomChanged && !countChanged) return;
  const groupId = Number(group.id);
  const lessons = await query<Row>(
    `SELECT lesson.*,
       EXISTS (SELECT 1 FROM academy_attendance mark WHERE mark.lesson_id = lesson.id) AS has_attendance
     FROM academy_lessons lesson
     WHERE lesson.group_id = $1
     ORDER BY lesson.scheduled_at, lesson.id
     FOR UPDATE OF lesson`,
    [groupId],
  );
  // A group without lessons gets them from materializeGroupLessons.
  if (lessons.length === 0) return;
  const pending = lessons.filter((lesson) => lesson.status === 'scheduled' && !lesson.hasAttendance
    && (!timesFollow || new Date(lesson.scheduledAt).getTime() > reference.getTime()));
  const reassignment = (lesson: Row) => {
    const values: Row = {};
    // A substitute teacher or another room chosen for one lesson stays.
    if (teacherChanged && sameId(lesson.teacherId, previous.teacherId)) values.teacherId = Number(group.teacherId) || null;
    if (roomChanged && sameId(lesson.roomId, previous.roomId)) values.roomId = Number(group.roomId) || null;
    return values;
  };
  if (!timesFollow) {
    for (const lesson of pending) {
      const values = reassignment(lesson);
      if (Object.keys(values).length > 0) await updateRow('academy_lessons', Number(lesson.id), values);
    }
    return;
  }

  const kept = lessons.filter((lesson) => lesson.status !== 'cancelled' && !pending.includes(lesson));
  const target = countChanged ? Math.max(0, Number(group.lessonCount) - kept.length) : pending.length;
  const moving = pending.slice(0, target);
  const dropped = pending.slice(target);
  const added = target - moving.length;
  if (dropped.length > 0) {
    // Authored and published learning content stays attached to its lesson.
    const run = await queryOne('SELECT id FROM lms_group_runs WHERE group_id = $1 FOR UPDATE', [groupId]);
    if (run && await hasProtectedLearningContent(Number(run.id), dropped.map((lesson) => Number(lesson.id)))) {
      throw Object.assign(new Error('groupCourseLessonsHistoryLocked'), { statusCode: 409 });
    }
  }

  let slots: Array<{ scheduledAt: Date; durationMinutes: number }> = [];
  if (timetableChanged || added > 0) {
    const startBoundary = group.startDate
      ? getZonedDateOnlyRange(new Date(group.startDate), ACADEMY_TIME_ZONE).start.getTime() - 1
      : reference.getTime();
    const latest = (rows: Row[]) => Math.max(0, ...rows.map((lesson) => new Date(lesson.scheduledAt).getTime()));
    // A new timetable starts after the lessons that stay; added lessons follow the last planned one.
    const after = new Date(Math.max(reference.getTime(), startBoundary, latest(kept), timetableChanged ? 0 : latest(moving)));
    const needed = timetableChanged ? target : added;
    slots = buildFollowingRecurringLessonSchedule({
      after,
      schedule: group.schedule,
      lessonCount: needed,
      fallbackDurationMinutes: Number(group.lessonDurationMinutes),
      timeZone: ACADEMY_TIME_ZONE,
    });
    if (slots.length !== needed) {
      throw Object.assign(new Error('groupLessonGenerationFailed'), { statusCode: 409 });
    }
  }

  const reason = 'Изменение расписания группы';
  const pendingIds = pending.map((lesson) => Number(lesson.id));
  for (const lesson of dropped) {
    await updateRow('academy_lessons', Number(lesson.id), { status: 'cancelled' });
    await insertRow('academy_lesson_status_history', {
      lessonId: Number(lesson.id), fromStatus: lesson.status, toStatus: 'cancelled', changedBy: actorId, comment: reason,
    });
  }
  for (const [index, lesson] of moving.entries()) {
    const values = reassignment(lesson);
    if (timetableChanged) {
      values.scheduledAt = slots[index].scheduledAt;
      values.durationMinutes = slots[index].durationMinutes;
    }
    if (Object.keys(values).length === 0) continue;
    await prepareLesson({ values, oldRow: lesson, excludeLessonId: Number(lesson.id), excludeLessonIds: pendingIds });
    await updateRow('academy_lessons', Number(lesson.id), values);
    if (values.scheduledAt && new Date(values.scheduledAt).getTime() !== new Date(lesson.scheduledAt).getTime()) {
      await insertRow('academy_lesson_reschedules', {
        lessonId: Number(lesson.id),
        previousScheduledAt: new Date(lesson.scheduledAt),
        nextScheduledAt: values.scheduledAt,
        reason,
        changedBy: actorId,
      });
    }
  }
  if (added > 0) {
    const course = await queryOne(`SELECT program FROM academy_courses WHERE id = $1`, [group.courseId]);
    const program = readProgram(course?.program);
    let lessonNumber = Math.max(0, ...lessons.map((lesson) => Number(lesson.lessonNumber))) + 1;
    for (const slot of timetableChanged ? slots.slice(moving.length) : slots) {
      const programLesson = program.find((item) => Number(item.lessonNumber) === lessonNumber);
      const values: Row = {
        groupId,
        courseId: Number(group.courseId),
        schoolId: Number(group.schoolId) || null,
        roomId: Number(group.roomId) || null,
        teacherId: Number(group.teacherId) || null,
        lessonNumber,
        topic: nullableText(programLesson?.topic) ?? `Занятие ${lessonNumber}`,
        materials: nullableText(programLesson?.description) ?? null,
        materialFileIds: [],
        scheduledAt: slot.scheduledAt,
        durationMinutes: slot.durationMinutes,
        status: 'scheduled',
      };
      await prepareLesson({ values, excludeLessonIds: pendingIds });
      await insertRow('academy_lessons', values);
      lessonNumber += 1;
    }
  }
  if (timetableChanged || countChanged) {
    const last = await queryOne<{ lastAt: Date | null }>(
      `SELECT max(scheduled_at) AS last_at FROM academy_lessons WHERE group_id = $1 AND status <> 'cancelled'`,
      [groupId],
    );
    if (last?.lastAt) {
      await updateRow('academy_groups', groupId, {
        endDate: calendarDateToUtcMarker(calendarDateFromInstant(new Date(last.lastAt))),
      });
    }
  }
}
