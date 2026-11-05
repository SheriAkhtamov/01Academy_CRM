import { addDays } from "@shared/academy";
import { boardTaskEmployeeArchiveSql } from "../../lib/board-task-archive";
import { createNotification, leadershipUserAccessSql, query, queryOne, type Row } from "./academy-core";
import { createSystemBoardTask } from "./system-board-tasks";

const absenceTaskTitle = (studentName: string | null | undefined) =>
  `3 пропуска подряд: позвонить родителю${studentName ? ` (${studentName})` : ""}`;

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
  // The card belongs to the pupil, not to its title: a renamed pupil or card and
  // a sibling with the same name never match another pupil's call.
  const onceKey = `student_absence:${Number(currentStudent.id)}`;
  if (!risks.length) {
    // A corrected register removes the streak, so its open call card is
    // finalized: there is nothing left for anybody to do or accept.
    const closed = await query<{ id: number; fromStatus: string }>(
      `UPDATE board_tasks target SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       FROM (SELECT task.id, task.status FROM board_tasks task
         WHERE task.status IN ('backlog', 'todo', 'in_progress')
           AND NOT ${boardTaskEmployeeArchiveSql("task")}
           AND EXISTS (SELECT 1 FROM board_task_activity activity
             WHERE activity.task_id = task.id AND activity.type = 'created' AND activity.meta->>'onceKey' = $1)
         FOR UPDATE) previous
       WHERE target.id = previous.id
       RETURNING target.id, previous.status AS from_status`,
      [onceKey],
    );
    for (const task of closed) {
      await query(
        `INSERT INTO board_task_activity (task_id, actor_id, type, from_value, to_value, meta)
         VALUES ($1, NULL, 'accepted', $2, 'accepted', $3::jsonb)`,
        [task.id, task.fromStatus, JSON.stringify({ source: "student_absence" })],
      );
    }
    return;
  }
  // Only a newly recorded absence in the current streak creates a new call.
  // Re-saving an unchanged mark or editing an older lesson cannot repeat it.
  if (!risks.some(risk => Number(risk.groupId) === currentGroupId
    && risk.lessonIds.some(lessonId => newAbsenceLessonIds.includes(Number(lessonId))))) return;
  const responsible = await queryOne<{ id: number }>(
    `SELECT u.id FROM users u WHERE u.is_active=true AND u.is_archived=false
      AND (u.id=$1 OR u.id=$2 OR ${leadershipUserAccessSql})
      ORDER BY CASE WHEN u.id=$1 THEN 0 WHEN u.id=$2 THEN 1 ELSE 2 END,u.id LIMIT 1`,
    [currentStudent.managerId ?? null, fallbackResponsibleId],
  );
  if (!responsible) return;
  const responsibleId = Number(responsible.id);
  // While the call card is still open, a longer streak does not add another.
  const task = await createSystemBoardTask(query, {
    title: absenceTaskTitle(currentStudent.studentName),
    assigneeId: responsibleId,
    leadId: currentStudent.leadId ? Number(currentStudent.leadId) : null,
    dueAt: addDays(new Date(), 1),
    source: "student_absence",
    onceKey,
  });
  if (!task) return;
  await createNotification(responsibleId, "Риск по посещаемости",
    `${currentStudent.studentName ?? "Ученик"} пропустил 3 занятия подряд`, "student", Number(student.id));
}
