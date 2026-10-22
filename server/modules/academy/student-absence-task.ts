import { addDays } from "@shared/academy";
import { createNotification, createTask, query, queryOne, type Row } from "./academy-core";

const absenceTaskTitle = "3 пропуска подряд: позвонить родителю";

/** The task is about the pupil: resolve it only after every active group is clear. */
export async function reconcileStudentAbsenceTask(student: Row, fallbackResponsibleId: number) {
  const risks = await query<{ groupId: number }>(
    `SELECT membership.group_id
    FROM academy_student_group_enrollments membership
    CROSS JOIN LATERAL (
      SELECT ARRAY(
        SELECT a.status::text FROM academy_lessons l
        JOIN academy_attendance a ON a.lesson_id=l.id AND a.student_id=membership.student_id
        WHERE l.group_id=membership.group_id AND l.status='conducted'
          AND l.scheduled_at>=membership.enrolled_at
          AND (membership.ended_at IS NULL OR l.scheduled_at<membership.ended_at)
        ORDER BY l.scheduled_at DESC,l.id DESC LIMIT 3
      ) AS statuses
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
  if (existingTask) return;
  const responsibleId = student.managerId ?? fallbackResponsibleId;
  await createTask(absenceTaskTitle, {
    responsibleId,
    entityType: "student",
    entityId: Number(student.id),
    deadlineAt: addDays(new Date(), 1),
  });
  await createNotification(responsibleId, "Риск по посещаемости",
    `${student.studentName ?? "Ученик"} пропустил 3 занятия подряд`, "student", Number(student.id));
}
