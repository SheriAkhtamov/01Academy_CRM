import type { LessonStaff, LessonStaffTeacher } from '@shared/contracts/lesson-staff';
import type { ActorContext } from '../leads/domain/actor-context';
import { createAudit, query, queryOne, withTransaction, type Row } from './academy-core';
import { canManageTeacherLesson, canRecordTeacherLessonAttendance } from './teacher-lesson-access';

export class LessonStaffError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 400) { super(code); }
}
const fail = (code: string, status = 400): never => { throw new LessonStaffError(code, status); };

async function authorize(actor: ActorContext, lessonId: number, mutate: boolean): Promise<Row> {
  if (!actor.userId || !(actor.isLeadership || actor.modules.some(module => ['administration', 'teacher'].includes(module)))) {
    fail('accessDenied', 403);
  }
  const lesson = await queryOne(`SELECT lesson.*, teacher.user_id AS teacher_user_id,
      teacher.full_name AS teacher_name, teacher.status AS teacher_status
    FROM academy_lessons lesson LEFT JOIN academy_teachers teacher ON teacher.id=lesson.teacher_id
    WHERE lesson.id=$1 FOR ${mutate ? 'UPDATE' : 'SHARE'} OF lesson`, [lessonId]);
  if (!lesson) fail('lessonStaffNotFound', 404);
  const canManage = canManageTeacherLesson(actor, lesson!);
  if (!canManage && (mutate || !await canRecordTeacherLessonAttendance(actor, lesson!))) {
    fail('teacherOwnLessonRosterOnly', 403);
  }
  if (mutate && !['scheduled', 'conducted'].includes(lesson!.status)) fail('lessonStaffReadOnly', 409);
  return { ...lesson!, canManage };
}

async function present(lesson: Row): Promise<LessonStaff> {
  const [assistants, teachers] = await Promise.all([
    query(`SELECT teacher.id,teacher.full_name FROM academy_lesson_assistants assistant
      JOIN academy_teachers teacher ON teacher.id=assistant.teacher_id
      WHERE assistant.lesson_id=$1 ORDER BY teacher.full_name,teacher.id`, [lesson.id]),
    lesson.canManage
      ? query("SELECT id,full_name FROM academy_teachers WHERE status='active' AND id<>$1 ORDER BY full_name,id", [lesson.teacherId ?? 0])
      : Promise.resolve([]),
  ]);
  const teacher = (row: Row): LessonStaffTeacher => ({ id: Number(row.id), fullName: row.fullName });
  return {
    teacher: lesson.teacherId ? { id: Number(lesson.teacherId), fullName: lesson.teacherName } : null,
    assistants: assistants.map(teacher), teachers: teachers.map(teacher),
    canManage: lesson.canManage,
  };
}

export class LessonStaffService {
  get(actor: ActorContext, lessonId: number) {
    return withTransaction(async () => present(await authorize(actor, lessonId, false)));
  }

  add(actor: ActorContext, lessonId: number, teacherId: number) {
    return withTransaction(async () => {
      const lesson = await authorize(actor, lessonId, true);
      if (Number(lesson.teacherId) === teacherId) fail('lessonAssistantIsTeacher');
      const teacher = await queryOne("SELECT id FROM academy_teachers WHERE id=$1 AND status='active' FOR SHARE", [teacherId]);
      if (!teacher) fail('lessonAssistantUnavailable', 409);
      const inserted = await query(`INSERT INTO academy_lesson_assistants(lesson_id,teacher_id,assigned_by)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING teacher_id`, [lessonId, teacherId, actor.userId]);
      if (inserted.length) await createAudit(actor, 'lesson_assistant_added', 'academy_lesson', lessonId, { teacherId });
      return present(lesson);
    });
  }

  remove(actor: ActorContext, lessonId: number, teacherId: number) {
    return withTransaction(async () => {
      const lesson = await authorize(actor, lessonId, true);
      const removed = await query('DELETE FROM academy_lesson_assistants WHERE lesson_id=$1 AND teacher_id=$2 RETURNING teacher_id', [lessonId, teacherId]);
      if (removed.length) await createAudit(actor, 'lesson_assistant_removed', 'academy_lesson', lessonId, { teacherId });
      return present(lesson);
    });
  }
}
