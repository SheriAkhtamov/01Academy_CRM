import { addDays } from "@shared/academy";
import { createNotification, createTask, leadershipUserAccessSql, query, queryOne, type Row } from "./academy-core";

const absenceTaskTitle = "3 пропуска подряд: позвонить родителю";

/** The task is about the pupil: resolve it only after every active group is clear. */
export async function reconcileStudentAbsenceTask(
  student: Row,
  currentGroupId: number,
  fallbackResponsibleId: number | null,
  newAbsenceLessonIds: readonly number[],
) {
  const currentStudent = await queryOne<Row>("SELECT * FROM academy_students WHERE id = $1 FOR UPDATE", [student.id]);
  if (!currentStudent) return;
  const risks = await query<{ groupId: number; lessonIds: number[] }>(
    `SELECT membership.group_id,recent.lesson_ids
    FROM academy_student_group_enrollments membership
    CROSS JOIN LATERAL (
      SELECT array_agg(latest.status ORDER BY latest.scheduled_at DESC,latest.id DESC) AS statuses,
        array_agg(latest.id ORDER BY latest.scheduled_at DESC,latest.id DESC) AS lesson_ids
      FROM (
        SELECT l.id,l.scheduled_at,a.status::text FROM academy_lessons l
        JOIN academy_attendance a ON a.lesson_id=l.id AND a.student_id=membership.student_id
        WHERE l.group_id=membership.group_id AND l.status='conducted'
          AND l.scheduled_at>=membership.enrolled_at
          AND (membership.ended_at IS NULL OR l.scheduled_at<membership.ended_at)
        ORDER BY l.scheduled_at DESC,l.id DESC LIMIT 3
      ) latest
    ) recent
    WHERE membership.student_id=$1 AND membership.status='active'
      AND recent.statuses=ARRAY['absent','absent','absent']::text[]`,
    [student.id],
  );
  const existingTask = await queryOne(
    `SELECT id FROM academy_tasks WHERE entity_type='student' AND entity_id=$1
      AND title=$2 AND status<>'done' LIMIT 1`,
    [student.id, absenceTaskTitle],
  );
  if (!risks.length) {
    if (existingTask) await query(
      `UPDATE academy_tasks SET status='done',completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
        WHERE id=$1 AND status<>'done'`,
      [existingTask.id],
    );
    return;
  }
  // Only a newly recorded absence in the current streak creates a new call.
  // Re-saving an unchanged mark or editing an older lesson cannot repeat a done call.
  if (existingTask || !risks.some(risk => Number(risk.groupId) === currentGroupId
    && risk.lessonIds.some(lessonId => newAbsenceLessonIds.includes(Number(lessonId))))) return;
  const responsible = await queryOne<{ id: number }>(
    `SELECT u.id FROM users u WHERE u.is_active=true AND u.is_archived=false
      AND (u.id=$1 OR u.id=$2 OR ${leadershipUserAccessSql})
      ORDER BY CASE WHEN u.id=$1 THEN 0 WHEN u.id=$2 THEN 1 ELSE 2 END,u.id LIMIT 1`,
    [currentStudent.managerId ?? null, fallbackResponsibleId],
  );
  if (!responsible) return;
  const responsibleId = Number(responsible.id);
  await createTask(absenceTaskTitle, {
    responsibleId,
    entityType: "student",
    entityId: Number(student.id),
    deadlineAt: addDays(new Date(), 1),
  });
  await createNotification(responsibleId, "Риск по посещаемости",
    `${currentStudent.studentName ?? "Ученик"} пропустил 3 занятия подряд`, "student", Number(student.id));
}
