import { hasLeadershipAccess } from '@shared/academy';
import type { SalesDemoStudent, SalesDemoVisit } from '@shared/contracts/sales-demo-students';
import { query, type DatasetActor } from './academy-core';
import { academyDateOnlyKey, type ReportingRange } from './academy-scheduling';

// Attendance is an explicit participant mark. A scheduled lesson can already
// have saved attendance; cancelled, not-conducted and future demos cannot.
// Reporting follows frozen KPI ownership, not the current operational owner.
const attendanceOwnerSql = `CASE WHEN academy_kpi_employee_role($3) = 'closer'
  THEN COALESCE(trial.closer_id, tracked.closer_id, lead.manager_id, student.manager_id)
  ELSE COALESCE(trial.hunter_id, tracked.hunter_id, handoff.from_manager_id, lead.manager_id, student.manager_id) END`;
export const salesDemoAttendanceCte = `WITH attended_demos AS (
  SELECT participant.id AS participant_id, demo.id AS demo_id,
    demo.scheduled_at, demo.duration_minutes, demo.format,
    demo.course_id, demo.school_id, demo.room_id, demo.teacher_id,
    student.id AS student_id,
    CASE WHEN $3::int IS NULL OR lead.manager_id = $3 THEN lead.id END AS lead_id,
    COALESCE(NULLIF(BTRIM(student.student_name), ''), lead.student_name) AS student_name,
    COALESCE(NULLIF(BTRIM(student.contact_name), ''), lead.contact_name) AS contact_name,
    CASE WHEN $3::int IS NULL OR COALESCE(lead.manager_id, student.manager_id) = $3
      THEN COALESCE(NULLIF(BTRIM(student.phone), ''), lead.phone) END AS phone,
    ${attendanceOwnerSql} AS manager_id
  FROM academy_demo_lesson_participants participant
  JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
  JOIN academy_students student ON student.id = participant.student_id
  LEFT JOIN academy_leads lead ON lead.id = student.lead_id
  LEFT JOIN academy_sales_kpi_trials trial ON trial.participant_id = participant.id
  LEFT JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = lead.id
  LEFT JOIN academy_lead_funnel_handoffs handoff ON handoff.lead_id = lead.id
  WHERE participant.status = 'attended'
    AND demo.status IN ('scheduled', 'completed')
    AND demo.scheduled_at <= timezone('UTC', now())
    AND demo.scheduled_at >= $1 AND demo.scheduled_at < $2
    AND ($3::int IS NULL OR ${attendanceOwnerSql} = $3)
)`;

const scopeValues = (actor: DatasetActor, range: ReportingRange, requestedManagerId: number | null) => [
  range.start, range.end, hasLeadershipAccess(actor) ? requestedManagerId : actor.userId,
];

/** A student contributes once, on their first attendance within this range. */
export async function buildSalesDemoAttendanceStats(actor: DatasetActor, range: ReportingRange, requestedManagerId: number | null = null) {
  const rows = await query<{ studentId: number; happenedAt: Date }>(
    `${salesDemoAttendanceCte}
     SELECT student_id, MIN(scheduled_at) AS happened_at
     FROM attended_demos GROUP BY student_id`, scopeValues(actor, range, requestedManagerId),
  );
  const daily = new Map<string, number>();
  for (const row of rows) {
    const date = academyDateOnlyKey(new Date(row.happenedAt));
    daily.set(date, (daily.get(date) ?? 0) + 1);
  }
  return { count: rows.length, daily };
}

type AttendanceRow = Omit<SalesDemoStudent, 'visits'> & Omit<SalesDemoVisit, 'scheduledAt'> & { scheduledAt: Date };

export async function buildSalesDemoStudents(actor: DatasetActor, range: ReportingRange, requestedManagerId: number | null = null): Promise<SalesDemoStudent[]> {
  // academy-core.query converts the top-level SQL aliases to camelCase.
  const rows = await query<AttendanceRow>(`${salesDemoAttendanceCte}
    SELECT attendance.*, course.name AS course_name, school.name AS school_name,
      room.name AS room_name, teacher.full_name AS teacher_name, manager.full_name AS manager_name
    FROM attended_demos attendance
    JOIN academy_courses course ON course.id = attendance.course_id
    JOIN academy_schools school ON school.id = attendance.school_id
    LEFT JOIN academy_rooms room ON room.id = attendance.room_id
    JOIN academy_teachers teacher ON teacher.id = attendance.teacher_id
    LEFT JOIN users manager ON manager.id = attendance.manager_id
    ORDER BY attendance.scheduled_at DESC, attendance.participant_id DESC`, scopeValues(actor, range, requestedManagerId));
  const students = new Map<number, SalesDemoStudent>();
  for (const row of rows) {
    let student = students.get(row.studentId);
    if (!student) {
      student = { studentId: row.studentId, leadId: row.leadId, studentName: row.studentName,
        contactName: row.contactName, phone: row.phone, managerId: row.managerId, managerName: row.managerName, visits: [] };
      students.set(row.studentId, student);
    }
    student.visits.push({ participantId: row.participantId, demoId: row.demoId,
      scheduledAt: new Date(row.scheduledAt).toISOString(), durationMinutes: row.durationMinutes,
      format: row.format, courseName: row.courseName, schoolName: row.schoolName,
      roomName: row.roomName, teacherName: row.teacherName });
  }
  return [...students.values()];
}
