import {
  courseCurriculumSchema,
  courseLessonMaterialsText,
  courseLessonFileIds,
  flattenCourseCurriculum,
  orderSelectedCourseLessons,
  selectedCourseLessonIdsSchema,
} from '@shared/contracts/course-curriculum';
import { buildFollowingRecurringLessonSchedule } from '../../lib/lesson-schedule';
import { getZonedDateTimeParts } from '../../lib/academy-time';
import { ACADEMY_TIME_ZONE, insertRow, query, queryOne, updateRow, type Row } from './academy-core';

const invalid = (key: string, statusCode = 400): never => { throw Object.assign(new Error(key), { statusCode }); };

export function parseCourseCurriculum(program: unknown) {
  const parsed = courseCurriculumSchema.safeParse(program);
  if (!parsed.success) invalid('courseCurriculumInvalid');
  return parsed.data;
}

export async function assertCourseCurriculumUpdateAllowed(courseId: number, program: unknown) {
  const ids = flattenCourseCurriculum(program).map(lesson => lesson.id);
  const used = await queryOne(`SELECT id FROM academy_groups
    WHERE course_id=$1 AND selected_course_lesson_ids IS NOT NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(selected_course_lesson_ids) selected(id)
        WHERE NOT (selected.id=ANY($2::text[]))) LIMIT 1`, [courseId, ids]);
  if (used) invalid('courseLessonsInUse', 409);
}

export function prepareGroupCourseLessons(values: Row, oldRow: Row | null | undefined, program: unknown) {
  const requested = values.selectedCourseLessonIds;
  const oldIds = oldRow?.selectedCourseLessonIds;
  if (requested == null && oldRow && oldIds == null) {
    delete values.selectedCourseLessonIds;
    return;
  }
  if (requested === undefined && !oldRow && !flattenCourseCurriculum(program).length) return;
  const parsed = selectedCourseLessonIdsSchema.safeParse(requested ?? oldIds);
  if (!parsed.success) return invalid('courseLessonsSelectionRequired');
  const lessons = orderSelectedCourseLessons(program, parsed.data);
  if (lessons.length !== parsed.data.length) invalid('courseLessonsSelectionInvalid');
  values.selectedCourseLessonIds = lessons.map(lesson => lesson.id);
  values.lessonCount = lessons.length;
}

type PrepareLesson = (options: { values: Row; oldRow?: Row; excludeLessonId?: number; excludeLessonIds?: number[] }) => Promise<void>;

/** Preserve every row and any started lesson. Only unused future timetable slots may change. */
export async function reconcileGroupCourseLessons(group: Row, previous: Row, prepareLesson: PrepareLesson, actorId: number | null = null) {
  if (group.selectedCourseLessonIds == null) return;
  const course = await queryOne('SELECT program FROM academy_courses WHERE id=$1', [group.courseId]);
  const desired = orderSelectedCourseLessons(course?.program, group.selectedCourseLessonIds);
  const all = await query<Row>(`SELECT lesson.*,
    EXISTS(SELECT 1 FROM academy_attendance mark WHERE mark.lesson_id=lesson.id) AS has_attendance
    FROM academy_lessons lesson WHERE lesson.group_id=$1 ORDER BY lesson.lesson_number,lesson.id FOR UPDATE OF lesson`, [group.id]);
  if (!all.length) return;
  if (group.isArchived || !['open', 'in_progress'].includes(String(group.status))) invalid('groupCourseLessonsHistoryLocked', 409);
  const oldProgram = flattenCourseCurriculum(course?.program);
  const oldIds: string[] = previous.selectedCourseLessonIds ?? oldProgram.map(lesson => lesson.id);
  const active = all.filter(lesson => lesson.status !== 'cancelled');
  const reference = new Date();
  const source = (lesson: Row) => lesson.courseLessonId ?? oldIds[Number(lesson.lessonNumber) - 1];
  const fixed = active.filter(lesson => lesson.status !== 'scheduled' || lesson.hasAttendance || new Date(lesson.scheduledAt) <= reference);
  if (fixed.some((lesson, index) => desired[index]?.id !== source(lesson))) invalid('groupCourseLessonsHistoryLocked', 409);
  const pending = active.filter(lesson => !fixed.includes(lesson));
  const remaining = desired.slice(fixed.length);
  const retained = new Set(remaining.map(lesson => lesson.id));
  const removed = pending.filter(lesson => !retained.has(source(lesson)));
  const run = await queryOne('SELECT id,course_version_id FROM lms_group_runs WHERE group_id=$1 FOR UPDATE', [group.id]);
  if (run) {
    // Authored and published learning content remains attached to its original lesson.
    const protectedContent = await queryOne(`SELECT binding.lesson_id FROM lms_lesson_bindings binding
      WHERE binding.run_id=$1 AND binding.lesson_id=ANY($2::int[]) AND (
        EXISTS(SELECT 1 FROM lms_materials material WHERE material.run_id=binding.run_id AND material.unit_id=binding.unit_id
          AND (material.created_by IS NOT NULL OR material.state<>'draft'
            OR EXISTS(SELECT 1 FROM lms_material_publications publication WHERE publication.material_id=material.id)))
        OR EXISTS(SELECT 1 FROM lms_assignments assignment WHERE assignment.run_id=binding.run_id AND assignment.unit_id=binding.unit_id)
        OR EXISTS(SELECT 1 FROM lms_quizzes quiz WHERE quiz.run_id=binding.run_id AND quiz.unit_id=binding.unit_id)) LIMIT 1`,
    [run.id, pending.map(lesson => lesson.id)]);
    if (protectedContent) invalid('groupCourseLessonsHistoryLocked', 409);
    const pinned = await queryOne('SELECT program FROM lms_course_versions WHERE id=$1', [run.courseVersionId]);
    const pinnedIds = new Set(flattenCourseCurriculum(pinned?.program).map(lesson => lesson.id));
    if (remaining.some(lesson => !pinnedIds.has(lesson.id))) invalid('groupCourseLessonsVersionLocked', 409);
  }
  const slots = pending.map(lesson => ({ scheduledAt: new Date(lesson.scheduledAt), durationMinutes: Number(lesson.durationMinutes) }))
    .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  if (slots.length < remaining.length) {
    const last = slots.at(-1)?.scheduledAt ?? fixed.at(-1)?.scheduledAt;
    slots.push(...buildFollowingRecurringLessonSchedule({
      after: new Date(Math.max(reference.getTime(), last ? new Date(last).getTime() : 0)),
      schedule: group.schedule,
      lessonCount: remaining.length - slots.length,
      fallbackDurationMinutes: Number(group.lessonDurationMinutes), timeZone: ACADEMY_TIME_ZONE,
    }));
  }
  if (slots.length < remaining.length) invalid('groupLessonGenerationFailed', 409);
  // Keep cancelled history's ordinals; future lessons use the available sequence after started lessons.
  const offset = Math.max(...all.map(lesson => Number(lesson.lessonNumber)), desired.length) + all.length + desired.length + 1;
  for (const [index, lesson] of pending.filter(item => !removed.includes(item)).entries()) await updateRow('academy_lessons', lesson.id, { lessonNumber: offset + index });
  for (const lesson of removed) {
    await updateRow('academy_lessons', lesson.id, { status: 'cancelled' });
    await insertRow('academy_lesson_status_history', { lessonId: Number(lesson.id), fromStatus: lesson.status, toStatus: 'cancelled', changedBy: actorId, comment: 'Изменение программы группы' });
  }
  for (const lesson of fixed) {
    if (!lesson.courseLessonId) await updateRow('academy_lessons', lesson.id, { courseLessonId: source(lesson) });
  }
  const excluded = pending.map(lesson => Number(lesson.id));
  const occupied = new Set([...all.filter(lesson => lesson.status === 'cancelled'), ...fixed, ...removed].map(lesson => Number(lesson.lessonNumber)));
  let nextNumber = Math.max(0, ...fixed.map(lesson => Number(lesson.lessonNumber))) + 1;
  for (const [index, lesson] of remaining.entries()) {
    while (occupied.has(nextNumber)) nextNumber++;
    const existing = pending.find(item => source(item) === lesson.id);
    const values: Row = {
      lessonNumber: nextNumber++, courseLessonId: lesson.id,
      scheduledAt: slots[index].scheduledAt, durationMinutes: slots[index].durationMinutes,
    };
    if (existing) {
      await prepareLesson({ values, oldRow: existing, excludeLessonId: Number(existing.id), excludeLessonIds: excluded });
      await updateRow('academy_lessons', existing.id, values);
      if (new Date(existing.scheduledAt).getTime() !== slots[index].scheduledAt.getTime()) await insertRow('academy_lesson_reschedules', {
        lessonId: Number(existing.id), previousScheduledAt: new Date(existing.scheduledAt), nextScheduledAt: slots[index].scheduledAt,
        reason: 'Изменение программы группы', changedBy: actorId,
      });
    } else {
      Object.assign(values, { groupId: Number(group.id), courseId: Number(group.courseId), schoolId: Number(group.schoolId), roomId: Number(group.roomId), teacherId: Number(group.teacherId), topic: lesson.title, materials: courseLessonMaterialsText(lesson), materialFileIds: courseLessonFileIds(lesson), status: 'scheduled' });
      await prepareLesson({ values, excludeLessonIds: excluded });
      await insertRow('academy_lessons', values);
    }
  }
  const finalDate = slots[remaining.length - 1]?.scheduledAt ?? fixed.at(-1)?.scheduledAt;
  if (finalDate) {
    const date = getZonedDateTimeParts(new Date(finalDate), ACADEMY_TIME_ZONE);
    await updateRow('academy_groups', group.id, { endDate: new Date(Date.UTC(date.year, date.month - 1, date.day)) });
  }
}
