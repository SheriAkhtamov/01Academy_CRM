WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY lesson_id, student_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS keeper_id,
    ROW_NUMBER() OVER (
      PARTITION BY lesson_id, student_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS duplicate_rank
  FROM academy_lesson_surveys
), duplicates AS (
  SELECT id, keeper_id FROM ranked WHERE duplicate_rank > 1
)
UPDATE academy_tasks AS task
SET entity_id = duplicates.keeper_id,
    updated_at = NOW()
FROM duplicates
WHERE task.entity_type = 'lesson_survey'
  AND task.entity_id = duplicates.id;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lesson_id, student_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS duplicate_rank
  FROM academy_lesson_surveys
)
DELETE FROM academy_lesson_surveys AS survey
USING ranked
WHERE survey.id = ranked.id
  AND ranked.duplicate_rank > 1;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY student_id, period
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS keeper_id,
    ROW_NUMBER() OVER (
      PARTITION BY student_id, period
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS duplicate_rank
  FROM academy_parent_surveys
), duplicates AS (
  SELECT id, keeper_id FROM ranked WHERE duplicate_rank > 1
)
UPDATE academy_tasks AS task
SET entity_id = duplicates.keeper_id,
    updated_at = NOW()
FROM duplicates
WHERE task.entity_type = 'parent_survey'
  AND task.entity_id = duplicates.id;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_id, period
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS duplicate_rank
  FROM academy_parent_surveys
)
DELETE FROM academy_parent_surveys AS survey
USING ranked
WHERE survey.id = ranked.id
  AND ranked.duplicate_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_lesson_surveys_lesson_student_unique"
  ON "academy_lesson_surveys" USING btree ("lesson_id", "student_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_parent_surveys_student_period_unique"
  ON "academy_parent_surveys" USING btree ("student_id", "period");
