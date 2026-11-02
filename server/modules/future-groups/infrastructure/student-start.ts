import { query } from "../../academy/academy-core";

/** Called inside the group lifecycle transaction; booking and payment never start teaching. */
export async function startWaitingGroupStudents(
  groupId: number,
  actorId: number,
) {
  await query(
    `WITH started AS (
    UPDATE academy_students s SET status='studying',updated_at=NOW()
    WHERE s.status='waiting_start' AND EXISTS(
      SELECT 1 FROM academy_student_group_enrollments e JOIN academy_groups g ON g.id=e.group_id
      WHERE e.student_id=s.id AND e.group_id=$1 AND e.status='active' AND g.status='in_progress'
    ) RETURNING s.id
  ) INSERT INTO academy_student_status_history(student_id,from_status,to_status,changed_by,comment)
    SELECT id,'waiting_start','studying',$2,'Начало обучения группы' FROM started`,
    [groupId, actorId],
  );
}
