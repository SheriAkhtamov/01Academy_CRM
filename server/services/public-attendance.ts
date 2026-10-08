import { createHash, scrypt, timingSafeEqual } from 'node:crypto';
import type { PublicAttendanceBulkMark, PublicAttendanceGroup, PublicAttendanceLesson, PublicAttendanceMark, PublicAttendanceRoster } from '@shared/contracts/public-attendance';
import { ACADEMY_SCHEDULING_ADVISORY_LOCK, query, queryOne, withTransaction, type Row } from '../modules/academy/academy-core';
import { getLessonRoster } from '../modules/academy/academy-route-support';
import { recalculateStudentMetrics } from '../modules/academy/academy-leads';

export interface PublicAttendanceSettings {
  passwordHash: string;
  groupIds: number[];
}

export class PublicAttendanceError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

export const attendanceSettingsFingerprint = (settings: PublicAttendanceSettings) => createHash('sha256')
  .update(JSON.stringify([settings.passwordHash, [...settings.groupIds].sort((a, b) => a - b)]))
  .digest('hex');

export const verifyAttendancePassword = async (password: string, hash: string) => {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(hash);
  if (!match) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, match[1], 64, (error, key) => error ? reject(error) : resolve(key));
  });
  return timingSafeEqual(derived, Buffer.from(match[2], 'hex'));
};

const lessonStarted = (lesson: Row) => new Date(lesson.scheduledAt).getTime() <= Date.now();
const canMarkLesson = (lesson: Row) => lessonStarted(lesson) && ['scheduled', 'conducted'].includes(lesson.status);

const toLesson = (lesson: Row, fullyMarked: boolean): PublicAttendanceLesson => ({
  id: Number(lesson.id),
  groupId: Number(lesson.groupId),
  number: Number(lesson.lessonNumber),
  scheduledAt: new Date(lesson.scheduledAt).toISOString(),
  durationMinutes: Number(lesson.durationMinutes),
  status: String(lesson.status),
  canMark: canMarkLesson(lesson),
  fullyMarked,
});

/*
  A started lesson can have every mark and still be "scheduled": lessons are
  completed in order, so it waits until the lessons before it are filled. The
  register shows such a lesson as done, because for the visitor it is — so for
  the started, not yet completed lessons the marks are counted against each
  lesson's roster, with one query for all of their marks.
*/
const findFullyMarkedLessons = async (lessons: Row[]) => {
  const started = lessons.filter((lesson) => lesson.status === 'scheduled' && lessonStarted(lesson));
  if (!started.length) return new Set<number>();
  const [rosters, marks] = await Promise.all([
    Promise.all(started.map((lesson) => getLessonRoster(Number(lesson.groupId), lesson.scheduledAt))),
    query(`SELECT lesson_id, student_id FROM academy_attendance WHERE lesson_id = ANY($1::int[])`, [started.map((lesson) => Number(lesson.id))]),
  ]);
  const marked = new Set(marks.map((mark) => `${Number(mark.lessonId)}:${Number(mark.studentId)}`));
  return new Set(started.filter((lesson, index) => rosters[index].length > 0
    && rosters[index].every((student) => marked.has(`${Number(lesson.id)}:${Number(student.id)}`))).map((lesson) => Number(lesson.id)));
};

const getScopedLesson = async (lessonId: number, groupIds: number[]) => {
  const lesson = await queryOne(
    `SELECT lesson.* FROM academy_lessons lesson
     JOIN academy_groups academy_group ON academy_group.id = lesson.group_id
     WHERE lesson.id = $1 AND academy_group.id = ANY($2::int[])
       AND academy_group.is_archived = false AND lesson.status IN ('scheduled', 'conducted')
     FOR UPDATE OF lesson`,
    [lessonId, groupIds],
  );
  if (!lesson) throw new PublicAttendanceError('publicAttendanceNotFound', 404);
  return lesson;
};

const readRoster = async (lesson: Row): Promise<PublicAttendanceRoster> => {
  const students = await getLessonRoster(Number(lesson.groupId), lesson.scheduledAt);
  const [marks, organizations] = await Promise.all([
    query(`SELECT student_id, status, updated_at::text AS revision FROM academy_attendance WHERE lesson_id = $1`, [lesson.id]),
    query(`SELECT student.id, lead.comment FROM academy_students student
      LEFT JOIN academy_leads lead ON lead.id = student.lead_id WHERE student.id = ANY($1::int[])`, [students.map((student) => Number(student.id))]),
  ]);
  const byStudent = new Map(marks.map((mark) => [Number(mark.studentId), mark]));
  const byOrganization = new Map(organizations.map((row) => {
    const organization = typeof row.comment === 'string' ? /^Организация:\s*(.+)$/m.exec(row.comment)?.[1]?.trim() ?? null : null;
    return [Number(row.id), organization] as const;
  }));
  return {
    lesson: toLesson(lesson, students.length > 0 && students.every((student) => byStudent.has(Number(student.id)))),
    students: students.map((student) => ({
      id: Number(student.id), name: String(student.studentName || student.contactName),
      organization: byOrganization.get(Number(student.id)) ?? null,
      status: byStudent.get(Number(student.id))?.status ?? null,
      revision: byStudent.get(Number(student.id))?.revision ?? null,
    })),
  };
};

const audit = async (action: string, entityType: string, entityId: number | null, before: Row | null, after: Row) => {
  await query(`INSERT INTO audit_logs (action, entity_type, entity_id, old_values, new_values)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
  [action, entityType, entityId, before ? JSON.stringify(before) : null, JSON.stringify({ ...after, source: 'public_attendance_page' })]);
};

// A later lesson can collect marks while an earlier lesson is incomplete.
// Once that earlier roster is filled, complete consecutive filled lessons in order.
const completeFilledLessons = async (groupId: number) => {
  const changedStudents = new Set<number>();
  const pending = await query(`SELECT * FROM academy_lessons WHERE group_id = $1 AND status = 'scheduled'
    AND scheduled_at <= NOW() ORDER BY scheduled_at, id FOR UPDATE`, [groupId]);
  for (const lesson of pending) {
    const roster = await getLessonRoster(groupId, lesson.scheduledAt);
    const marked = await query(`SELECT student_id FROM academy_attendance WHERE lesson_id = $1`, [lesson.id]);
    const ids = new Set(marked.map((row) => Number(row.studentId)));
    if (roster.length === 0 || roster.some((student) => !ids.has(Number(student.id)))) break;
    await query(`UPDATE academy_lessons SET status = 'conducted', updated_at = NOW() WHERE id = $1`, [lesson.id]);
    await query(`INSERT INTO academy_lesson_status_history (lesson_id, from_status, to_status, changed_by)
      VALUES ($1, 'scheduled', 'conducted', NULL)`, [lesson.id]);
    await audit('PUBLIC_ATTENDANCE_LESSON_COMPLETED', 'academy_lesson', Number(lesson.id), lesson, { ...lesson, status: 'conducted' });
    roster.forEach((student) => changedStudents.add(Number(student.id)));
  }
  return changedStudents;
};

export interface PublicAttendanceService {
  listGroups(groupIds: number[]): Promise<PublicAttendanceGroup[]>;
  loadRoster(lessonId: number, groupIds: number[]): Promise<PublicAttendanceRoster>;
  mark(lessonId: number, groupIds: number[], input: PublicAttendanceMark): Promise<PublicAttendanceRoster>;
  markMany(lessonId: number, groupIds: number[], input: PublicAttendanceBulkMark): Promise<PublicAttendanceRoster>;
}

export const publicAttendanceService: PublicAttendanceService = {
  async listGroups(groupIds) {
    const [groups, lessons] = await Promise.all([
      query(`SELECT id, name FROM academy_groups WHERE id = ANY($1::int[]) AND is_archived = false ORDER BY id`, [groupIds]),
      query(`SELECT lesson.* FROM academy_lessons lesson JOIN academy_groups academy_group ON academy_group.id = lesson.group_id
        WHERE academy_group.id = ANY($1::int[]) AND academy_group.is_archived = false AND lesson.status IN ('scheduled','conducted')
        ORDER BY lesson.scheduled_at, lesson.id`, [groupIds]),
    ]);
    const filled = await findFullyMarkedLessons(lessons);
    return groups.map((group) => ({
      id: Number(group.id), name: String(group.name).replace(/^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-\d{2}-\d+\s*[—-]\s*/, ''),
      lessons: lessons.filter((lesson) => Number(lesson.groupId) === Number(group.id))
        .map((lesson) => toLesson(lesson, lesson.status === 'conducted' || filled.has(Number(lesson.id)))),
    }));
  },
  loadRoster: (lessonId, groupIds) => withTransaction(async () => {
    await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
    return readRoster(await getScopedLesson(lessonId, groupIds));
  }),
  mark: (lessonId, groupIds, input) => withTransaction(async () => {
    await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
    const lesson = await getScopedLesson(lessonId, groupIds);
    if (!canMarkLesson(lesson)) throw new PublicAttendanceError('publicAttendanceLessonNotStarted', 409);
    const students = await getLessonRoster(Number(lesson.groupId), lesson.scheduledAt, true);
    if (!students.some((student) => Number(student.id) === input.studentId)) throw new PublicAttendanceError('publicAttendanceNotFound', 404);
    const current = await queryOne(`SELECT *, updated_at::text AS revision FROM academy_attendance
      WHERE lesson_id = $1 AND student_id = $2 FOR UPDATE`, [lessonId, input.studentId]);
    // Retries after a lost response are harmless when the desired value already exists.
    if ((current?.status ?? null) === input.status) return readRoster(lesson);
    if ((current?.revision ?? null) !== input.expectedRevision) throw new PublicAttendanceError('publicAttendanceConflict', 409);
    let saved: Row | undefined;
    if (input.status === null) {
      if (!input.clearConfirmed) throw new PublicAttendanceError('publicAttendanceInvalid', 400);
      await query(`DELETE FROM academy_attendance WHERE lesson_id = $1 AND student_id = $2`, [lessonId, input.studentId]);
    } else {
      saved = await queryOne(`INSERT INTO academy_attendance (lesson_id, student_id, status, marked_by)
        VALUES ($1, $2, $3, NULL) ON CONFLICT (lesson_id, student_id) DO UPDATE SET
          status = EXCLUDED.status, marked_by = NULL, updated_at = NOW() RETURNING *`, [lessonId, input.studentId, input.status]);
    }
    await audit(input.status === null ? 'PUBLIC_ATTENDANCE_CLEARED' : 'PUBLIC_ATTENDANCE_MARKED', 'academy_attendance',
      Number(saved?.id ?? current?.id) || null, current ?? null, { lessonId, studentId: input.studentId, status: input.status });
    const changed = await completeFilledLessons(Number(lesson.groupId));
    changed.add(input.studentId);
    for (const studentId of [...changed].sort((a, b) => a - b)) await recalculateStudentMetrics(studentId);
    return readRoster(await getScopedLesson(lessonId, groupIds));
  }),
  // "Mark the rest" fills only the students who are still unmarked when the write
  // runs, so a mark that landed after the visitor confirmed is never overwritten.
  markMany: (lessonId, groupIds, input) => withTransaction(async () => {
    await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
    const lesson = await getScopedLesson(lessonId, groupIds);
    if (!canMarkLesson(lesson)) throw new PublicAttendanceError('publicAttendanceLessonNotStarted', 409);
    const roster = new Set((await getLessonRoster(Number(lesson.groupId), lesson.scheduledAt, true)).map((student) => Number(student.id)));
    if (input.studentIds.some((studentId) => !roster.has(studentId))) throw new PublicAttendanceError('publicAttendanceNotFound', 404);
    const inserted = await query(`INSERT INTO academy_attendance (lesson_id, student_id, status, marked_by)
      SELECT $1, student_id, $3, NULL FROM unnest($2::int[]) AS student_id
      ON CONFLICT (lesson_id, student_id) DO NOTHING RETURNING *`, [lessonId, input.studentIds, input.status]);
    for (const row of inserted) {
      await audit('PUBLIC_ATTENDANCE_MARKED', 'academy_attendance', Number(row.id) || null, null,
        { lessonId, studentId: Number(row.studentId), status: input.status });
    }
    const changed = await completeFilledLessons(Number(lesson.groupId));
    inserted.forEach((row) => changed.add(Number(row.studentId)));
    for (const studentId of [...changed].sort((a, b) => a - b)) await recalculateStudentMetrics(studentId);
    return readRoster(await getScopedLesson(lessonId, groupIds));
  }),
};
