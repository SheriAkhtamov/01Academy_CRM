import { queryOne } from "./academy-core";

export const ensureGroupCapacity = async (
  groupId?: number | null,
  excludeLeadId?: number | null,
  excludeStudentId?: number | null,
) => {
  if (!groupId) return;
  const capacity = await queryOne<{
    currentStudents: number;
    reservedStudents: number;
    maxStudents: number;
  }>(
    `SELECT
       COUNT(DISTINCT s.id)::int AS current_students,
       COUNT(DISTINCT CASE WHEN reserved.id IS NOT NULL THEN reserved.id END)::int AS reserved_students,
       g.max_students
     FROM academy_groups g
     LEFT JOIN academy_student_group_enrollments enrollment
       ON enrollment.group_id = g.id
      AND enrollment.status = 'active'
      AND ($3::int IS NULL OR enrollment.student_id <> $3)
     LEFT JOIN academy_students s
       ON s.id = enrollment.student_id
      AND (g.status = 'planned' OR s.status IN ('studying', 'waiting_start'))
     LEFT JOIN academy_lead_group_reservations reserved_membership
      ON reserved_membership.group_id = g.id
     LEFT JOIN academy_leads reserved
      ON reserved.id = reserved_membership.lead_id
      AND COALESCE(reserved.is_archived, false) = false
      AND ($2::int IS NULL OR reserved.id <> $2)
      AND NOT EXISTS (
        SELECT 1 FROM academy_students existing_student WHERE existing_student.lead_id = reserved.id
      )
     WHERE g.id = $1
     GROUP BY g.id`,
    [groupId, excludeLeadId ?? null, excludeStudentId ?? null],
  );

  if (!capacity) {
    throw Object.assign(new Error("Group not found"), { statusCode: 404 });
  }
  if (
    Number(capacity.currentStudents || 0) +
      Number(capacity.reservedStudents || 0) >=
    Number(capacity.maxStudents)
  ) {
    throw Object.assign(new Error("groupIsFull"), { statusCode: 409 });
  }
};
