import type { Request, Response } from 'express';
import { hasLeadershipAccess, getComputedPaymentStatus } from '@shared/academy';
import { summarizeStudentProfile, type StudentLearningGroup, type StudentLessonAttendance, type StudentPayment, type StudentProject } from '@shared/contracts/student-profile';
import { SALES_MODULES, ensureModuleAccess, ensureLeadRowAccess, ensureLeadMutationAccess, parseId, query, queryOne } from './academy-core';
import { getLead } from './academy-leads';
import { studentProjectFileInfo } from '../../middleware/student-project-upload.middleware';

export async function loadAuthorizedStudent(req: Request, res: Response, mutate = false) {
  const teaching = req.query.context === 'teacher';
  if (!ensureModuleAccess(req, res, teaching ? new Set(['teacher']) : SALES_MODULES, 'Student access required')) return null;
  if (teaching && mutate) { res.status(403).json({ error: 'Student update access required' }); return null; }
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid student id' }); return null; }
  const teacher = teaching ? await queryOne(`SELECT teacher.id FROM academy_teachers teacher
    JOIN academy_groups g ON g.teacher_id = teacher.id
    JOIN academy_student_group_enrollments membership ON membership.group_id = g.id
    WHERE teacher.user_id = $1 AND membership.student_id = $2 AND membership.status = 'active' LIMIT 1`, [req.user!.id, id]) : null;
  if (teaching && !teacher) { res.status(403).json({ error: 'Student access required' }); return null; }
  const student = await queryOne(`SELECT student.*, manager.full_name AS manager_name
    FROM academy_students student LEFT JOIN users manager ON manager.id = student.manager_id WHERE student.id = $1`, [id]);
  if (!student) { res.status(404).json({ error: 'Student not found' }); return null; }
  if (teaching) return { student, lead: null, teacherId: Number(teacher!.id) };
  if (!hasLeadershipAccess(req.user) && Number(student.managerId) !== req.user!.id) {
    res.status(403).json({ error: 'Student access required' }); return null;
  }
  const lead = student.leadId ? await getLead(Number(student.leadId)) : null;
  if (lead && !(mutate ? ensureLeadMutationAccess(req, res, lead) : ensureLeadRowAccess(req, res, lead))) return null;
  return { student, lead, teacherId: null };
}

const wasStudyingSql = (lessonAlias: string) => `COALESCE((
  SELECT history.to_status FROM academy_student_status_history history
  WHERE history.student_id = $1 AND history.created_at <= ${lessonAlias}.scheduled_at
  ORDER BY history.created_at DESC, history.id DESC LIMIT 1
), 'studying') = 'studying'`;

export async function loadStudentProfileData(studentId: number, teacherId?: number | null) {
  const params = teacherId ? [studentId, teacherId] : [studentId];
  const [groupRows, attendance, paymentRows, projectRows] = await Promise.all([
    query(`SELECT membership.group_id, g.name AS group_name, course.name AS course_name,
      school.name AS school_name, teacher.full_name AS teacher_name, membership.is_primary, membership.enrolled_at,
      COALESCE(NULLIF(g.lesson_count, 0), NULLIF(course.lesson_count, 0)) AS planned_lessons,
      (SELECT COUNT(*)::int FROM academy_lessons previous WHERE previous.group_id = g.id
        AND previous.status = 'conducted') AS group_conducted_lessons,
      COUNT(lesson.id)::int AS conducted_lessons,
      COUNT(lesson.id) FILTER (WHERE mark.status = 'present')::int AS attended_lessons,
      COUNT(lesson.id) FILTER (WHERE mark.status = 'absent')::int AS missed_lessons
      FROM academy_student_group_enrollments membership
      JOIN academy_groups g ON g.id = membership.group_id
      LEFT JOIN academy_courses course ON course.id = g.course_id
      LEFT JOIN academy_schools school ON school.id = g.school_id
      LEFT JOIN academy_teachers teacher ON teacher.id = g.teacher_id
      LEFT JOIN academy_lessons lesson ON lesson.group_id = g.id AND lesson.status = 'conducted'
        AND lesson.scheduled_at >= membership.enrolled_at AND ${wasStudyingSql('lesson')}
      LEFT JOIN academy_attendance mark ON mark.lesson_id = lesson.id AND mark.student_id = $1
      WHERE membership.student_id = $1 AND membership.status = 'active' ${teacherId ? 'AND g.teacher_id = $2' : ''}
      GROUP BY membership.id, g.id, course.id, school.id, teacher.id
      ORDER BY membership.is_primary DESC, g.name`, params),
    query<StudentLessonAttendance>(`SELECT lesson.id AS lesson_id, lesson.topic, lesson.scheduled_at, g.name AS group_name,
      mark.status, mark.note FROM academy_lessons lesson
      JOIN academy_groups g ON g.id = lesson.group_id
      LEFT JOIN academy_attendance mark ON mark.lesson_id = lesson.id AND mark.student_id = $1
      WHERE lesson.status = 'conducted' AND (
        mark.id IS NOT NULL OR (EXISTS (
          SELECT 1 FROM academy_student_group_enrollments membership
          WHERE membership.student_id = $1 AND membership.group_id = lesson.group_id
            AND lesson.scheduled_at >= membership.enrolled_at
            AND (membership.ended_at IS NULL OR lesson.scheduled_at < membership.ended_at)
        ) AND ${wasStudyingSql('lesson')})
      ) ${teacherId ? 'AND g.teacher_id = $2' : ''} ORDER BY lesson.scheduled_at DESC, lesson.id DESC`, params),
    teacherId ? Promise.resolve<StudentPayment[]>([]) : query<StudentPayment>(`SELECT * FROM academy_payments WHERE student_id = $1 ORDER BY COALESCE(paid_at, due_at, created_at) DESC, id DESC`, [studentId]),
    query<StudentProject>(`SELECT project.* FROM academy_portfolio_projects project
      ${teacherId ? 'JOIN academy_groups g ON g.id = project.group_id' : ''}
      WHERE project.student_id = $1 ${teacherId ? 'AND g.teacher_id = $2' : ''} ORDER BY project.created_at DESC, project.id DESC`, params),
  ]);
  const groups: StudentLearningGroup[] = groupRows.map((group) => {
    const remainingLessons = group.plannedLessons === null ? null : Math.max(0, Number(group.plannedLessons) - Number(group.groupConductedLessons));
    const totalLessons = remainingLessons === null ? null : Number(group.conductedLessons) + remainingLessons;
    return { groupId: Number(group.groupId), groupName: group.groupName, courseName: group.courseName,
      schoolName: group.schoolName, teacherName: group.teacherName, isPrimary: group.isPrimary,
      enrolledAt: group.enrolledAt, totalLessons, completedLessons: Number(group.attendedLessons), remainingLessons,
      attendedLessons: Number(group.attendedLessons), missedLessons: Number(group.missedLessons) };
  });
  const payments = paymentRows.map((payment) => ({ ...payment, amountUzs: Number(payment.amountUzs),
    status: getComputedPaymentStatus(payment.status, payment.dueAt) }));
  const projects = projectRows.map((project) => ({ ...project, fileName: studentProjectFileInfo(project.fileUrl)?.fileName ?? null }));
  return { groups, attendance, payments, projects, summary: summarizeStudentProfile(groups, attendance, payments) };
}
