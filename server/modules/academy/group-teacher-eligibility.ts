import { query, queryOne } from './academy-core';

/** Selectable group teachers must still have an enabled employee account and Teacher access. */
export const groupTeacherEligibilitySql = `
  t.status = 'active'
  AND EXISTS (
    SELECT 1 FROM users employee
    WHERE employee.id = t.user_id
      AND employee.is_active = true
      AND employee.is_archived = false
      AND (employee.module = 'teacher' OR EXISTS (
        SELECT 1 FROM user_modules assigned
        WHERE assigned.user_id = employee.id AND assigned.module = 'teacher'
      ))
  )
`;

export const listEligibleGroupTeachers = () => query(`
  SELECT t.* FROM academy_teachers t
  WHERE ${groupTeacherEligibilitySql}
  ORDER BY t.full_name, t.id
`);

export async function assertEligibleGroupTeacher(teacherId: number) {
  const teacher = await queryOne(`SELECT t.* FROM academy_teachers t
    WHERE t.id = $1 AND ${groupTeacherEligibilitySql}`, [teacherId]);
  if (!teacher) throw Object.assign(new Error('teacherNotActive'), { statusCode: 400 });
  return teacher;
}
