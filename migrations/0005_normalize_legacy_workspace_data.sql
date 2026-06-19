UPDATE academy_lessons
SET status = 'conducted',
    updated_at = NOW()
WHERE status = 'completed';
--> statement-breakpoint
UPDATE academy_attendance
SET status = 'present',
    note = CASE
      WHEN note IS NULL OR note = '' THEN 'Опоздал на занятие'
      WHEN note LIKE '%Опоздал на занятие%' THEN note
      ELSE note || '; Опоздал на занятие'
    END,
    updated_at = NOW()
WHERE status = 'late';
--> statement-breakpoint
UPDATE academy_payments
SET status = 'paid',
    updated_at = NOW()
WHERE status = 'confirmed';
--> statement-breakpoint
UPDATE academy_payments
SET type = 'installment_1_2',
    updated_at = NOW()
WHERE type = 'installment';
--> statement-breakpoint
UPDATE academy_tasks
SET status = 'done',
    completed_at = COALESCE(completed_at, updated_at, created_at, NOW()),
    updated_at = NOW()
WHERE status = 'completed';
--> statement-breakpoint
WITH upcoming AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY scheduled_at, id) AS position
  FROM academy_lessons
  WHERE status = 'scheduled' AND scheduled_at < NOW()
)
UPDATE academy_lessons AS lessons
SET scheduled_at = CURRENT_DATE
      + (upcoming.position || ' days')::interval
      + CASE WHEN upcoming.position % 2 = 0 THEN interval '14 hours' ELSE interval '10 hours' END,
    updated_at = NOW()
FROM upcoming
WHERE lessons.id = upcoming.id;
--> statement-breakpoint
INSERT INTO academy_lesson_status_history
  (lesson_id, from_status, to_status, changed_by, comment, created_at)
SELECT
  lessons.id,
  'scheduled',
  'conducted',
  teachers.user_id,
  'Нормализация исторических тестовых данных',
  COALESCE(lessons.updated_at, lessons.created_at, NOW())
FROM academy_lessons lessons
LEFT JOIN academy_teachers teachers ON teachers.id = lessons.teacher_id
WHERE lessons.status = 'conducted'
  AND NOT EXISTS (
    SELECT 1
    FROM academy_lesson_status_history history
    WHERE history.lesson_id = lessons.id
      AND history.to_status = 'conducted'
  );
--> statement-breakpoint
INSERT INTO academy_student_status_history
  (student_id, from_status, to_status, changed_by, comment, created_at)
SELECT
  students.id,
  NULL,
  students.status,
  students.manager_id,
  'Начальный статус тестового ученика',
  COALESCE(students.enrolled_at, students.created_at, NOW())
FROM academy_students students
WHERE NOT EXISTS (
  SELECT 1
  FROM academy_student_status_history history
  WHERE history.student_id = students.id
);
--> statement-breakpoint
INSERT INTO academy_lesson_surveys
  (student_id, lesson_id, group_id, teacher_id, course_id, score, liked, improve, created_at)
SELECT
  attendance.student_id,
  attendance.lesson_id,
  lessons.group_id,
  lessons.teacher_id,
  lessons.course_id,
  CASE
    WHEN attendance.id % 13 = 0 THEN 2
    WHEN attendance.id % 5 = 0 THEN 4
    ELSE 5
  END,
  CASE
    WHEN attendance.id % 3 = 0 THEN 'Практическое задание'
    ELSE 'Понятное объяснение преподавателя'
  END,
  CASE
    WHEN attendance.id % 13 = 0 THEN 'Нужно больше времени на практику'
    WHEN attendance.id % 4 = 0 THEN 'Добавить больше примеров'
    ELSE NULL
  END,
  COALESCE(lessons.scheduled_at, NOW()) + interval '2 hours 30 minutes'
FROM academy_attendance attendance
JOIN academy_lessons lessons ON lessons.id = attendance.lesson_id
WHERE lessons.status = 'conducted'
  AND attendance.status = 'present'
  AND NOT EXISTS (
    SELECT 1
    FROM academy_lesson_surveys surveys
    WHERE surveys.student_id = attendance.student_id
      AND surveys.lesson_id = attendance.lesson_id
  );
--> statement-breakpoint
INSERT INTO academy_parent_surveys
  (student_id, group_id, course_id, progress_answer, joy_answer, continue_answer, nps_score, comment, period, created_at)
SELECT
  students.id,
  students.group_id,
  students.course_id,
  CASE WHEN students.id % 5 = 0 THEN 'Средний' ELSE 'Хороший' END,
  CASE WHEN students.id % 4 = 0 THEN 'Иногда' ELSE 'Да' END,
  CASE WHEN students.id % 7 = 0 THEN 'Не уверен' ELSE 'Да' END,
  CASE
    WHEN students.id % 7 = 0 THEN 6
    WHEN students.id % 3 = 0 THEN 8
    ELSE 10
  END,
  CASE
    WHEN students.id % 7 = 0 THEN 'Хотим обсудить дальнейший план обучения'
    ELSE 'Ребёнку нравится обучение и проекты'
  END,
  TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
  NOW() - ((students.id % 10) || ' days')::interval
FROM academy_students students
WHERE NOT EXISTS (
  SELECT 1
  FROM academy_parent_surveys surveys
  WHERE surveys.student_id = students.id
    AND surveys.period = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
);
--> statement-breakpoint
INSERT INTO academy_portfolio_projects
  (student_id, lesson_id, group_id, course_id, title, url, final_status, marketing_consent, created_at, updated_at)
SELECT
  students.id,
  latest_lesson.id,
  students.group_id,
  students.course_id,
  'AI-проект — ' || students.student_name,
  'https://example.com/01academy/portfolio/' || students.id,
  CASE
    WHEN students.id % 4 = 0 THEN 'presented'
    WHEN students.id % 3 = 0 THEN 'completed'
    ELSE 'in_progress'
  END,
  students.marketing_consent,
  NOW() - ((students.id % 14) || ' days')::interval,
  NOW()
FROM academy_students students
LEFT JOIN LATERAL (
  SELECT lessons.id
  FROM academy_lessons lessons
  WHERE lessons.group_id = students.group_id
    AND lessons.status = 'conducted'
  ORDER BY lessons.scheduled_at DESC, lessons.id DESC
  LIMIT 1
) latest_lesson ON TRUE
WHERE students.id IN (
  SELECT id FROM academy_students ORDER BY id LIMIT 10
)
  AND NOT EXISTS (
    SELECT 1
    FROM academy_portfolio_projects projects
    WHERE projects.student_id = students.id
  );
--> statement-breakpoint
INSERT INTO academy_marketing_expenses
  (source_id, channel, campaign_name, period_start, period_end, amount_uzs, created_by, created_at, updated_at)
SELECT
  sources.id,
  seed.channel,
  seed.campaign_name,
  DATE_TRUNC('month', CURRENT_DATE),
  DATE_TRUNC('month', CURRENT_DATE) + interval '1 month - 1 second',
  seed.amount_uzs,
  creator.id,
  NOW(),
  NOW()
FROM (
  VALUES
    ('instagram_ad_default', 'instagram', 'Instagram Ads — текущий месяц', 1800000),
    ('instagram_reels', 'instagram', 'Reels promotion — текущий месяц', 650000),
    ('telegram_ad', 'telegram', 'Telegram Ads — текущий месяц', 900000),
    ('blogger_default', 'blogger', 'Интеграции с блогерами — текущий месяц', 750000),
    ('event_default', 'event', 'Открытый урок — текущий месяц', 500000)
) AS seed(source_code, channel, campaign_name, amount_uzs)
JOIN academy_lead_sources sources ON sources.code = seed.source_code
CROSS JOIN LATERAL (
  SELECT id
  FROM users
  WHERE role IN ('smm_manager', 'head', 'admin') AND is_active = true
  ORDER BY CASE role WHEN 'smm_manager' THEN 0 WHEN 'head' THEN 1 ELSE 2 END, id
  LIMIT 1
) creator
WHERE NOT EXISTS (
  SELECT 1
  FROM academy_marketing_expenses expenses
  WHERE expenses.campaign_name = seed.campaign_name
    AND expenses.period_start = DATE_TRUNC('month', CURRENT_DATE)
);
--> statement-breakpoint
INSERT INTO academy_referral_rewards
  (referrer_student_id, referred_lead_id, referred_student_id, reward_type, reward_value, status, created_at, applied_at)
SELECT
  referrer.id,
  referred.lead_id,
  referred.id,
  'discount',
  CASE WHEN referred.id % 3 = 0 THEN 'Бесплатный месяц' ELSE '15%' END,
  'applied',
  NOW() - ((referred.id % 12) || ' days')::interval,
  NOW() - ((referred.id % 5) || ' days')::interval
FROM academy_students referrer
JOIN academy_students referred
  ON referred.referral_code IN ('REF-011', 'REF-012', 'REF-013', 'REF-014', 'REF-015')
WHERE referrer.referral_code = 'REF-001'
  AND NOT EXISTS (
    SELECT 1
    FROM academy_referral_rewards rewards
    WHERE rewards.referrer_student_id = referrer.id
      AND rewards.referred_student_id = referred.id
  );
--> statement-breakpoint
UPDATE academy_students
SET referral_level = 'ai_ambassador',
    updated_at = NOW()
WHERE referral_code = 'REF-001'
  AND (
    SELECT COUNT(*)
    FROM academy_referral_rewards rewards
    WHERE rewards.referrer_student_id = academy_students.id
      AND rewards.status = 'applied'
  ) >= 5;
