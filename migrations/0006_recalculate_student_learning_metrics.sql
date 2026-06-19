WITH student_metrics AS (
  SELECT
    students.id,
    (
      SELECT COUNT(*)::integer
      FROM academy_lessons lessons
      WHERE lessons.group_id = students.group_id
        AND lessons.status = 'conducted'
    ) AS conducted_lessons,
    (
      SELECT COUNT(*)::integer
      FROM academy_attendance attendance
      JOIN academy_lessons lessons ON lessons.id = attendance.lesson_id
      WHERE attendance.student_id = students.id
        AND attendance.status = 'present'
        AND lessons.status = 'conducted'
    ) AS present_lessons,
    (
      SELECT AVG(surveys.score)
      FROM academy_lesson_surveys surveys
      WHERE surveys.student_id = students.id
    ) AS satisfaction_average,
    COALESCE(courses.lesson_count, 0) AS course_lessons
  FROM academy_students students
  LEFT JOIN academy_courses courses ON courses.id = students.course_id
),
calculated AS (
  SELECT
    id,
    CASE
      WHEN conducted_lessons <= 0 THEN 0
      ELSE ROUND((present_lessons::numeric / conducted_lessons) * 100)::integer
    END AS attendance_percent,
    CASE
      WHEN course_lessons <= 0 THEN 0
      ELSE LEAST(100, ROUND((present_lessons::numeric / course_lessons) * 100)::integer)
    END AS progress_percent,
    COALESCE(ROUND(satisfaction_average)::integer, 0) AS satisfaction_avg
  FROM student_metrics
)
UPDATE academy_students AS students
SET
  attendance_percent = calculated.attendance_percent,
  progress_percent = calculated.progress_percent,
  satisfaction_avg = calculated.satisfaction_avg,
  risk_flags = TO_JSONB(ARRAY_REMOVE(ARRAY[
    CASE
      WHEN calculated.attendance_percent > 0 AND calculated.attendance_percent < 70
        THEN 'attendance_below_70'
    END,
    CASE
      WHEN calculated.attendance_percent > 0 AND calculated.attendance_percent < 50
        THEN 'churn_risk'
    END,
    CASE
      WHEN calculated.satisfaction_avg > 0 AND calculated.satisfaction_avg < 3
        THEN 'low_satisfaction'
    END
  ]::text[], NULL)),
  updated_at = NOW()
FROM calculated
WHERE students.id = calculated.id;
