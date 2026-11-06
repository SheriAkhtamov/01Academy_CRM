import { queryOne } from "./academy-core";

export const ensureGroupCapacity = async (
  groupId?: number | null,
  excludeStudentId?: number | null,
) => {
  if (!groupId) return;
  const capacity = await queryOne<{
    currentStudents: number;
    maxStudents: number;
  }>(
    `SELECT
       COUNT(DISTINCT s.id)::int AS current_students,
       g.max_students
     FROM academy_groups g
     LEFT JOIN academy_student_group_enrollments enrollment
       ON enrollment.group_id = g.id
      AND enrollment.status = 'active'
      AND ($2::int IS NULL OR enrollment.student_id <> $2)
     LEFT JOIN academy_students s
       ON s.id = enrollment.student_id
      AND (g.status = 'planned' OR s.status IN ('studying', 'waiting_start'))
     WHERE g.id = $1
     GROUP BY g.id`,
    [groupId, excludeStudentId ?? null],
  );

  if (!capacity) {
    throw Object.assign(new Error("Group not found"), { statusCode: 404 });
  }
  if (
    Number(capacity.currentStudents || 0) >= Number(capacity.maxStudents)
  ) {
    throw Object.assign(new Error("groupIsFull"), { statusCode: 409 });
  }
};
