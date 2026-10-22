import type {
  PublicAttendanceReport, PublicAttendanceReportCounts, PublicAttendanceReportGroup, PublicAttendanceReportQuery, PublicAttendanceReportStudent,
} from '@shared/contracts/public-attendance';
import { query } from '../modules/academy/academy-core';
import { getLessonRoster } from '../modules/academy/academy-route-support';

const emptyCounts = () => ({ present: 0, absent: 0, unmarked: 0 });

export async function loadPublicAttendanceReport(groupIds: number[], period: PublicAttendanceReportQuery): Promise<PublicAttendanceReport> {
  const [groups, lessons] = await Promise.all([
    query(`SELECT id, name FROM academy_groups WHERE id = ANY($1::int[]) AND is_archived = false ORDER BY id`, [groupIds]),
    query(`SELECT lesson.id, lesson.group_id, lesson.scheduled_at FROM academy_lessons lesson
      JOIN academy_groups academy_group ON academy_group.id = lesson.group_id
      WHERE academy_group.id = ANY($1::int[]) AND academy_group.is_archived = false
        AND lesson.status IN ('scheduled', 'conducted') AND lesson.scheduled_at <= (NOW() AT TIME ZONE 'UTC')
        AND ($2::date IS NULL OR lesson.scheduled_at >= (($2::date::timestamp AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'UTC'))
        AND ($3::date IS NULL OR lesson.scheduled_at < ((($3::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'UTC'))
      ORDER BY lesson.scheduled_at, lesson.id`, [groupIds, period.from ?? null, period.to ?? null]),
  ]);
  const marks = lessons.length ? await query(
    `SELECT mark.lesson_id,mark.student_id,mark.status,student.student_name,student.contact_name
     FROM academy_attendance mark JOIN academy_students student ON student.id=mark.student_id
     WHERE mark.lesson_id = ANY($1::int[])`,
    [lessons.map((lesson) => Number(lesson.id))],
  ) : [];
  const byMark = new Map(marks.map((mark) => [`${mark.lessonId}:${mark.studentId}`, mark.status]));
  const markedStudents = new Map<number, Map<number, { id: number; studentName: string; contactName: string }>>();
  for (const mark of marks) {
    if (!['present', 'absent'].includes(mark.status)) continue;
    const students = markedStudents.get(Number(mark.lessonId)) ?? new Map();
    students.set(Number(mark.studentId), { id: Number(mark.studentId), studentName: mark.studentName, contactName: mark.contactName });
    markedStudents.set(Number(mark.lessonId), students);
  }
  const byGroup = new Map<number, PublicAttendanceReportGroup>(groups.map((group) => [Number(group.id), {
    id: Number(group.id), name: String(group.name).replace(/^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-\d{2}-\d+\s*[—-]\s*/, ''),
    lessonCount: 0, students: [], ...emptyCounts(),
  }]));
  const studentsByGroup = new Map<number, Map<number, PublicAttendanceReportStudent>>();
  const studentIds = new Set<number>();

  // Reuse the register's historical membership rules, with bounded concurrency
  // so opening a report cannot consume the entire database pool.
  for (let offset = 0; offset < lessons.length; offset += 4) {
    const batch = lessons.slice(offset, offset + 4);
    const rosters = await Promise.all(batch.map((lesson) => getLessonRoster(Number(lesson.groupId), lesson.scheduledAt)));
    batch.forEach((lesson, index) => {
      const groupId = Number(lesson.groupId);
      const group = byGroup.get(groupId);
      if (!group) return;
      group.lessonCount += 1;
      const students = studentsByGroup.get(groupId) ?? new Map<number, PublicAttendanceReportStudent>();
      studentsByGroup.set(groupId, students);
      const historicalStudents = new Map(rosters[index].map(row => [Number(row.id), row]));
      for (const [id, row] of markedStudents.get(Number(lesson.id)) ?? []) historicalStudents.set(id, row);
      for (const row of historicalStudents.values()) {
        const id = Number(row.id);
        studentIds.add(id);
        const student = students.get(id) ?? {
          id, name: String(row.studentName || row.contactName), organization: null, ...emptyCounts(),
        };
        const mark = byMark.get(`${lesson.id}:${id}`);
        const status: keyof PublicAttendanceReportCounts = mark === 'present' || mark === 'absent' ? mark : 'unmarked';
        student[status] += 1;
        group[status] += 1;
        students.set(id, student);
      }
    });
  }
  const organizations = studentIds.size ? await query(`SELECT student.id, lead.comment FROM academy_students student
    LEFT JOIN academy_leads lead ON lead.id = student.lead_id WHERE student.id = ANY($1::int[])`, [[...studentIds]]) : [];
  const byOrganization = new Map(organizations.map((row) => [Number(row.id), typeof row.comment === 'string'
    ? /^Организация:\s*(.+)$/m.exec(row.comment)?.[1]?.trim() ?? null : null]));
  const totals = { ...emptyCounts(), lessonCount: 0, studentCount: studentIds.size };
  for (const group of byGroup.values()) {
    group.students = [...(studentsByGroup.get(group.id)?.values() ?? [])].map((student) => ({
      ...student, organization: byOrganization.get(student.id) ?? null,
    })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    totals.lessonCount += group.lessonCount;
    totals.present += group.present;
    totals.absent += group.absent;
    totals.unmarked += group.unmarked;
  }
  return { groups: [...byGroup.values()], totals };
}
