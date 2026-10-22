import { calculateAttendancePercent, calculateProgressPercent, resolveStudentRiskFlags } from "@shared/academy";
import { studentGroupMetricsSql } from "../../lib/student-group-metrics-sql";
import { query } from "./academy-core";

export type StudentGroupLearningMetrics = {
  groupId: number;
  conductedLessons: number;
  attendedLessons: number;
  missedLessons: number;
  totalLessons: number | null;
  remainingLessons: number | null;
  monthMarkedLessons: number;
  monthAttendedLessons: number;
  attendancePercent: number | null;
  progressPercent: number | null;
};

export function summarizeStudentLearningMetrics(
  groups: StudentGroupLearningMetrics[],
  attendance?: { present: number; absent: number },
) {
  const present = attendance?.present ?? groups.reduce((sum, group) => sum + group.attendedLessons, 0);
  const absent = attendance?.absent ?? groups.reduce((sum, group) => sum + group.missedLessons, 0);
  const planned = groups.every(group => group.totalLessons !== null)
    ? groups.reduce((sum, group) => sum + Number(group.totalLessons), 0)
    : 0;
  const riskFlags = [...new Set(groups.flatMap(group => resolveStudentRiskFlags({
    conductedCount: group.attendedLessons + group.missedLessons,
    attendancePercent: group.attendancePercent ?? 0,
    monthConductedCount: group.monthMarkedLessons,
    monthAttendancePercent: calculateAttendancePercent(group.monthAttendedLessons, group.monthMarkedLessons),
  })))];
  return {
    groups,
    attendancePercent: calculateAttendancePercent(present, present + absent),
    progressPercent: calculateProgressPercent(groups.reduce((sum, group) => sum + group.attendedLessons, 0), planned),
    riskFlags,
  };
}

export async function loadStudentLearningMetrics(studentIds: number[], teacherId?: number | null) {
  const result = new Map<number, ReturnType<typeof summarizeStudentLearningMetrics>>();
  if (!studentIds.length) return result;
  const records = await query<StudentGroupLearningMetrics & {
    studentId: number;
    globalPresent: number;
    globalAbsent: number;
  }>(
    `WITH attendance AS (
      SELECT mark.student_id,COUNT(*) FILTER(WHERE mark.status='present')::int AS present,
        COUNT(*) FILTER(WHERE mark.status='absent')::int AS absent
      FROM academy_attendance mark JOIN academy_lessons lesson ON lesson.id=mark.lesson_id
      WHERE mark.student_id=ANY($1::int[]) AND lesson.status='conducted' GROUP BY mark.student_id
    ) SELECT student.id AS student_id,membership.group_id,metrics.*,
      COALESCE(attendance.present,0) AS global_present,COALESCE(attendance.absent,0) AS global_absent
    FROM academy_students student
    LEFT JOIN academy_student_group_enrollments membership ON membership.student_id=student.id AND membership.status='active'
      AND ($2::int IS NULL OR EXISTS(SELECT 1 FROM academy_groups teacher_group WHERE teacher_group.id=membership.group_id AND teacher_group.teacher_id=$2))
    LEFT JOIN LATERAL (${studentGroupMetricsSql("student.id", "membership.group_id", "membership.enrolled_at", "membership.ended_at")}) metrics ON membership.id IS NOT NULL
    LEFT JOIN attendance ON attendance.student_id=student.id
    WHERE student.id=ANY($1::int[]) ORDER BY student.id,membership.id`,
    [studentIds, teacherId ?? null],
  );
  const byStudent = new Map<number, typeof records>();
  for (const record of records) {
    byStudent.set(Number(record.studentId), [...(byStudent.get(Number(record.studentId)) ?? []), record]);
  }
  for (const [studentId, records] of byStudent) {
    const groups: StudentGroupLearningMetrics[] = records.filter(record => Number(record.groupId) > 0).map(record => ({
      groupId: Number(record.groupId),
      conductedLessons: record.conductedLessons,
      attendedLessons: record.attendedLessons,
      missedLessons: record.missedLessons,
      totalLessons: record.totalLessons,
      remainingLessons: record.remainingLessons,
      monthMarkedLessons: record.monthMarkedLessons,
      monthAttendedLessons: record.monthAttendedLessons,
      attendancePercent: record.attendancePercent,
      progressPercent: record.progressPercent,
    }));
    result.set(studentId, summarizeStudentLearningMetrics(groups, teacherId ? undefined : {
      present: records[0].globalPresent,
      absent: records[0].globalAbsent,
    }));
  }
  return result;
}
