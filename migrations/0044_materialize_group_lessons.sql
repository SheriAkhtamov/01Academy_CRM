-- Groups historically stored only a weekly recurrence. Attendance, lesson
-- completion, and rescheduling work with concrete academy_lessons rows, so
-- materialize every active legacy group that does not have them yet.
LOCK TABLE "academy_groups" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE "academy_lessons" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

CREATE TEMP TABLE academy_group_lesson_backfill ON COMMIT DROP AS
WITH eligible_groups AS (
  SELECT
    academy_group.*,
    course."program",
    COALESCE(
      academy_group."start_date"::date,
      (
        COALESCE(
          (
            SELECT MIN(COALESCE(student."enrolled_at", student."created_at"))
            FROM "academy_students" AS student
            WHERE student."group_id" = academy_group."id"
          ),
          academy_group."created_at",
          NOW() AT TIME ZONE 'UTC'
        ) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'
      )::date
    ) AS generated_start_date
  FROM "academy_groups" AS academy_group
  JOIN "academy_courses" AS course ON course."id" = academy_group."course_id"
  WHERE academy_group."status" IN ('open', 'in_progress')
    AND academy_group."teacher_id" IS NOT NULL
    AND academy_group."room_id" IS NOT NULL
    AND academy_group."lesson_count" > 0
    AND jsonb_typeof(academy_group."schedule") = 'array'
    AND jsonb_array_length(academy_group."schedule") > 0
    AND NOT EXISTS (
      SELECT 1
      FROM "academy_lessons" AS existing_lesson
      WHERE existing_lesson."group_id" = academy_group."id"
    )
), parsed_schedule AS (
  SELECT
    eligible_group.*,
    schedule_item.ordinality AS schedule_order,
    CASE
      WHEN schedule_item.value ->> 'dayOfWeek' ~ '^[1-7]$'
        THEN (schedule_item.value ->> 'dayOfWeek')::integer
      ELSE NULL
    END AS day_of_week,
    CASE
      WHEN schedule_item.value ->> 'startTime' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
        THEN (schedule_item.value ->> 'startTime')::time
      WHEN schedule_item.value ->> 'time' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
        THEN (schedule_item.value ->> 'time')::time
      ELSE NULL
    END AS start_time,
    CASE
      WHEN schedule_item.value ->> 'endTime' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
        THEN (schedule_item.value ->> 'endTime')::time
      ELSE NULL
    END AS end_time
  FROM eligible_groups AS eligible_group
  CROSS JOIN LATERAL jsonb_array_elements(eligible_group."schedule")
    WITH ORDINALITY AS schedule_item(value, ordinality)
), candidate_lessons AS (
  SELECT
    parsed_schedule.*,
    parsed_schedule.generated_start_date + day_offset.value AS lesson_date,
    (
      (
        (parsed_schedule.generated_start_date + day_offset.value + parsed_schedule.start_time)
        AT TIME ZONE 'Asia/Tashkent'
      ) AT TIME ZONE 'UTC'
    ) AS scheduled_at,
    ROUND(EXTRACT(EPOCH FROM (parsed_schedule.end_time - parsed_schedule.start_time)) / 60)::integer
      AS generated_duration_minutes
  FROM parsed_schedule
  CROSS JOIN LATERAL generate_series(
    0,
    GREATEST(370, parsed_schedule."lesson_count" * 14 + 14)
  ) AS day_offset(value)
  WHERE parsed_schedule.day_of_week IS NOT NULL
    AND parsed_schedule.start_time IS NOT NULL
    AND parsed_schedule.end_time IS NOT NULL
    AND parsed_schedule.end_time > parsed_schedule.start_time
    AND EXTRACT(ISODOW FROM parsed_schedule.generated_start_date + day_offset.value)
      = parsed_schedule.day_of_week
), numbered_lessons AS (
  SELECT
    candidate_lesson.*,
    ROW_NUMBER() OVER (
      PARTITION BY candidate_lesson."id"
      ORDER BY candidate_lesson.scheduled_at, candidate_lesson.schedule_order
    )::integer AS generated_lesson_number
  FROM candidate_lessons AS candidate_lesson
)
SELECT
  numbered_lesson."id" AS group_id,
  numbered_lesson."course_id" AS course_id,
  numbered_lesson."school_id" AS school_id,
  numbered_lesson."room_id" AS room_id,
  numbered_lesson."teacher_id" AS teacher_id,
  numbered_lesson.generated_lesson_number AS lesson_number,
  COALESCE(
    NULLIF(BTRIM(program_lesson.value ->> 'topic'), ''),
    'Занятие ' || numbered_lesson.generated_lesson_number
  ) AS topic,
  NULLIF(BTRIM(program_lesson.value ->> 'description'), '') AS materials,
  numbered_lesson.scheduled_at,
  numbered_lesson.generated_duration_minutes AS duration_minutes,
  numbered_lesson.generated_start_date,
  numbered_lesson."start_date" AS previous_start_date,
  numbered_lesson."end_date" AS previous_end_date
FROM numbered_lessons AS numbered_lesson
LEFT JOIN LATERAL (
  SELECT program_item.value
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(numbered_lesson."program") = 'array' THEN numbered_lesson."program"
      ELSE '[]'::jsonb
    END
  ) AS program_item(value)
  WHERE program_item.value ->> 'lessonNumber' ~ '^[1-9][0-9]*$'
    AND (program_item.value ->> 'lessonNumber')::integer
      = numbered_lesson.generated_lesson_number
  LIMIT 1
) AS program_lesson ON TRUE
WHERE numbered_lesson.generated_lesson_number <= numbered_lesson."lesson_count";
--> statement-breakpoint

INSERT INTO "academy_lessons" (
  "group_id",
  "course_id",
  "school_id",
  "room_id",
  "teacher_id",
  "lesson_number",
  "topic",
  "materials",
  "scheduled_at",
  "duration_minutes",
  "status"
)
SELECT
  backfill.group_id,
  backfill.course_id,
  backfill.school_id,
  backfill.room_id,
  backfill.teacher_id,
  backfill.lesson_number,
  backfill.topic,
  backfill.materials,
  backfill.scheduled_at,
  backfill.duration_minutes,
  'scheduled'
FROM academy_group_lesson_backfill AS backfill
ORDER BY backfill.group_id, backfill.lesson_number;
--> statement-breakpoint

INSERT INTO "audit_logs" (
  "action",
  "entity_type",
  "entity_id",
  "old_values",
  "new_values"
)
SELECT
  'academy_group_lessons_materialized',
  'academy_group',
  backfill.group_id,
  jsonb_build_object(
    'startDate', MIN(backfill.previous_start_date),
    'endDate', MIN(backfill.previous_end_date),
    'lessonCount', 0
  ),
  jsonb_build_object(
    'startDate', MIN(backfill.generated_start_date),
    'endDate', MAX(backfill.scheduled_at)::date,
    'lessonCount', COUNT(*)
  )
FROM academy_group_lesson_backfill AS backfill
GROUP BY backfill.group_id;
--> statement-breakpoint

UPDATE "academy_groups" AS academy_group
SET
  "start_date" = generated_dates.generated_start_date,
  "end_date" = generated_dates.generated_end_date,
  "updated_at" = NOW()
FROM (
  SELECT
    backfill.group_id,
    MIN(backfill.generated_start_date)::timestamp AS generated_start_date,
    MAX(backfill.scheduled_at)::date::timestamp AS generated_end_date
  FROM academy_group_lesson_backfill AS backfill
  GROUP BY backfill.group_id
) AS generated_dates
WHERE academy_group."id" = generated_dates.group_id;
--> statement-breakpoint

-- Lesson numbers are semantic positions within one group. Normalize any
-- legacy duplicates by chronology before enforcing the invariant.
CREATE TEMP TABLE academy_lesson_number_repairs ON COMMIT DROP AS
WITH numbered AS (
  SELECT
    lesson."id" AS lesson_id,
    lesson."group_id",
    lesson."lesson_number" AS previous_lesson_number,
    ROW_NUMBER() OVER (
      PARTITION BY lesson."group_id"
      ORDER BY lesson."scheduled_at", lesson."id"
    )::integer AS next_lesson_number
  FROM "academy_lessons" AS lesson
)
SELECT *
FROM numbered
WHERE numbered.previous_lesson_number <> numbered.next_lesson_number;
--> statement-breakpoint

INSERT INTO "audit_logs" (
  "action",
  "entity_type",
  "entity_id",
  "old_values",
  "new_values"
)
SELECT
  'academy_lesson_number_normalized',
  'academy_lesson',
  repair.lesson_id,
  jsonb_build_object('lessonNumber', repair.previous_lesson_number),
  jsonb_build_object(
    'lessonNumber', repair.next_lesson_number,
    'reason', 'chronological group lesson numbering'
  )
FROM academy_lesson_number_repairs AS repair;
--> statement-breakpoint

UPDATE "academy_lessons" AS lesson
SET
  "lesson_number" = repair.next_lesson_number,
  "updated_at" = NOW()
FROM academy_lesson_number_repairs AS repair
WHERE lesson."id" = repair.lesson_id;
--> statement-breakpoint

CREATE UNIQUE INDEX "academy_lessons_group_lesson_number_unique"
  ON "academy_lessons" USING btree ("group_id", "lesson_number");
