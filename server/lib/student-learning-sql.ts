/** Use the status at the lesson time so a later pause never rewrites history. */
export const studentWasStudyingSql = (studentId: string, scheduledAt: string) => `COALESCE((
  SELECT history.to_status FROM academy_student_status_history history
  WHERE history.student_id = ${studentId} AND history.created_at <= ${scheduledAt}
  ORDER BY history.created_at DESC, history.id DESC LIMIT 1
), 'studying') = 'studying'`;

/** A scheduled publication belongs to the enrollment that was active when it opened. */
export const recipientEnrollmentVisibilitySql = (recipient = "recipient") =>
  `EXISTS(SELECT 1 FROM academy_student_group_enrollments publication_enrollment WHERE publication_enrollment.id=${recipient}.enrollment_id AND ${recipient}.opens_at>=publication_enrollment.enrolled_at AND (publication_enrollment.ended_at IS NULL OR ${recipient}.opens_at<publication_enrollment.ended_at))`;

/** Recorded attendance is a fact, including marks imported with older status history. */
export const studentLessonCountsSql = (studentId: string, lesson = "lesson") =>
  `(EXISTS(SELECT 1 FROM academy_attendance recorded_mark WHERE recorded_mark.student_id=${studentId} AND recorded_mark.lesson_id=${lesson}.id)
    OR ${studentWasStudyingSql(studentId, `${lesson}.scheduled_at`)})`;
