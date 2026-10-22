import { studentLessonCountsSql } from "./student-learning-sql";

/** The same enrollment boundaries and recorded facts drive CRM cards and lesson rosters. */
export const studentGroupMetricsSql = (
  studentId: string,
  groupId: string,
  enrolledAt: string,
  endedAt: string,
) => `
  WITH eligible_lessons AS MATERIALIZED (
    SELECT lesson.id,lesson.scheduled_at,mark.status
    FROM academy_lessons lesson
    LEFT JOIN academy_attendance mark ON mark.lesson_id=lesson.id AND mark.student_id=${studentId}
    WHERE lesson.group_id=${groupId} AND lesson.status='conducted'
      AND lesson.scheduled_at>=${enrolledAt}
      AND (${endedAt} IS NULL OR lesson.scheduled_at<${endedAt})
      AND ${studentLessonCountsSql(studentId)}
  ), counts AS (
    SELECT COUNT(*)::int AS conducted_lessons,
      COUNT(*) FILTER(WHERE status='present')::int AS attended_lessons,
      COUNT(*) FILTER(WHERE status='absent')::int AS missed_lessons,
      COUNT(*) FILTER(WHERE status IN('present','absent') AND scheduled_at>=
        ((date_trunc('month',NOW() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'UTC'))::int AS month_marked_lessons,
      COUNT(*) FILTER(WHERE status='present' AND scheduled_at>=
        ((date_trunc('month',NOW() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'UTC'))::int AS month_attended_lessons
    FROM eligible_lessons
  ), plan AS (
    SELECT CASE WHEN ${endedAt} IS NOT NULL THEN 0
      ELSE GREATEST(0,COALESCE(NULLIF(metrics_group.lesson_count,0),NULLIF(course.lesson_count,0))-
        (SELECT COUNT(*)::int FROM academy_lessons conducted WHERE conducted.group_id=metrics_group.id AND conducted.status='conducted'))
      END AS remaining_lessons,
      COALESCE(NULLIF(metrics_group.lesson_count,0),NULLIF(course.lesson_count,0)) IS NOT NULL AS has_plan
    FROM academy_groups metrics_group LEFT JOIN academy_courses course ON course.id=metrics_group.course_id
    WHERE metrics_group.id=${groupId}
  ), totals AS (
    SELECT counts.*,CASE WHEN plan.has_plan THEN plan.remaining_lessons END AS remaining_lessons,
      CASE WHEN plan.has_plan THEN counts.conducted_lessons+plan.remaining_lessons END AS total_lessons
    FROM counts CROSS JOIN plan
  ) SELECT totals.*,
    ROUND(100.0*attended_lessons/NULLIF(attended_lessons+missed_lessons,0))::int AS attendance_percent,
    CASE WHEN total_lessons>0 THEN LEAST(100,ROUND(100.0*attended_lessons/total_lessons))::int END AS progress_percent
  FROM totals`;
