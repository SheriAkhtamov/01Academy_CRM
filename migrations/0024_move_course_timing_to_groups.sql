ALTER TABLE "academy_groups" ADD COLUMN IF NOT EXISTS "lesson_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD COLUMN IF NOT EXISTS "lesson_duration_minutes" integer DEFAULT 120 NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD COLUMN IF NOT EXISTS "duration_days" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD COLUMN IF NOT EXISTS "frequency" varchar(255);
--> statement-breakpoint
UPDATE "academy_groups" AS group_row
SET
  "lesson_count" = COALESCE(NULLIF(group_row."lesson_count", 0), course_row."lesson_count", 0),
  "lesson_duration_minutes" = COALESCE(NULLIF(group_row."lesson_duration_minutes", 0), course_row."lesson_duration_minutes", 120),
  "duration_days" = COALESCE(NULLIF(group_row."duration_days", 0), course_row."duration_days", 0),
  "frequency" = COALESCE(NULLIF(group_row."frequency", ''), course_row."frequency")
FROM "academy_courses" AS course_row
WHERE course_row."id" = group_row."course_id";
