import type { ActorContext } from '../leads/domain/actor-context';
import { queryOne, type Row } from './academy-core';

export const teacherLessonVisibilitySql = (lessonAlias: string, teacherParameter = '$1') => `(
  ${lessonAlias}.teacher_id = ${teacherParameter} OR EXISTS (
    SELECT 1 FROM academy_lesson_assistants lesson_assistant
    WHERE lesson_assistant.lesson_id = ${lessonAlias}.id AND lesson_assistant.teacher_id = ${teacherParameter}
  )
)`;

export function canManageTeacherLesson(actor: ActorContext, lesson: Row): boolean {
  return actor.userId > 0 && (actor.isLeadership || actor.modules.includes('administration') || (
    actor.modules.includes('teacher') && Number(lesson.teacherUserId) === actor.userId
    && (lesson.teacherStatus === undefined || lesson.teacherStatus === 'active')
  ));
}

// Call after locking the lesson. Assignment changes take the same lesson lock,
// so revocation is checked against a fresh snapshot before attendance is saved.
export async function canRecordTeacherLessonAttendance(actor: ActorContext, lesson: Row): Promise<boolean> {
  if (canManageTeacherLesson(actor, lesson)) return true;
  if (!actor.userId || !actor.modules.includes('teacher')) return false;
  return Boolean(await queryOne(`SELECT assistant.teacher_id FROM academy_lesson_assistants assistant
    JOIN academy_teachers teacher ON teacher.id=assistant.teacher_id AND teacher.status='active'
    WHERE assistant.lesson_id=$1 AND teacher.user_id=$2`, [lesson.id, actor.userId]));
}
