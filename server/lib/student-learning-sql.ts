/** Use the status at the lesson time so a later pause never rewrites history. */
export const studentWasStudyingSql = (studentId: string, scheduledAt: string) => `COALESCE((
  SELECT history.to_status FROM academy_student_status_history history
  WHERE history.student_id = ${studentId} AND history.created_at <= ${scheduledAt}
  ORDER BY history.created_at DESC, history.id DESC LIMIT 1
), 'studying') = 'studying'`;
