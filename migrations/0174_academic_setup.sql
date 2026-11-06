-- Platform overhaul, stage 3 (expand): branches and courses carry the short
-- code used in group codes, group numbers come from a sequence instead of
-- audit records, an online group needs neither a branch nor a room, and a
-- lesson has its own note apart from the notes about each pupil.

ALTER TABLE "academy_schools" ADD COLUMN IF NOT EXISTS "short_code" varchar(10);
--> statement-breakpoint
ALTER TABLE "academy_courses" ADD COLUMN IF NOT EXISTS "short_code" varchar(10);
--> statement-breakpoint
-- Codes approved by the previous generator come first, then the codes the
-- project rules name, then the code most used in existing group names. Each
-- code goes to one row only.
WITH state AS (
  SELECT new_values::jsonb AS saved FROM "audit_logs"
  WHERE entity_type = 'academy_group_code_state' AND action = 'SAVE_GROUP_CODE_STATE'
  ORDER BY id DESC LIMIT 1
), saved AS (
  SELECT DISTINCT ON (upper(codes.value)) codes.key::int AS id, upper(codes.value) AS code
  FROM state, jsonb_each_text(COALESCE(state.saved->'schoolCodes', '{}'::jsonb)) codes
  WHERE codes.key ~ '^[0-9]{1,9}$' AND codes.value ~ '^[A-Za-z0-9]{1,10}$' AND upper(codes.value) <> 'ONL'
  ORDER BY upper(codes.value), codes.key::int
)
UPDATE "academy_schools" school SET "short_code" = saved.code
FROM saved WHERE school.id = saved.id AND school.short_code IS NULL;
--> statement-breakpoint
UPDATE "academy_schools" SET "short_code" = 'CYP'
WHERE short_code IS NULL AND lower(code) IN ('cyberpark', 'cyp')
  AND id = (SELECT min(id) FROM "academy_schools" WHERE lower(code) IN ('cyberpark', 'cyp'))
  AND NOT EXISTS (SELECT 1 FROM "academy_schools" other WHERE other.short_code = 'CYP');
--> statement-breakpoint
WITH used AS (
  SELECT school_id AS id, split_part(name, '-', 1) AS code, count(*) AS uses
  FROM "academy_groups"
  WHERE name ~ '^[A-Z0-9]{1,10}-[A-Z0-9]+-(GRP|IND)-[0-9]{2}-[0-9]+' AND split_part(name, '-', 1) <> 'ONL'
    AND school_id IS NOT NULL
  GROUP BY school_id, split_part(name, '-', 1)
), best AS (
  SELECT DISTINCT ON (id) id, code FROM used ORDER BY id, uses DESC, code
), free AS (
  SELECT DISTINCT ON (best.code) best.id, best.code FROM best
  WHERE NOT EXISTS (SELECT 1 FROM "academy_schools" taken WHERE taken.short_code = best.code)
  ORDER BY best.code, best.id
)
UPDATE "academy_schools" school SET "short_code" = free.code
FROM free WHERE school.id = free.id AND school.short_code IS NULL;
--> statement-breakpoint
WITH state AS (
  SELECT new_values::jsonb AS saved FROM "audit_logs"
  WHERE entity_type = 'academy_group_code_state' AND action = 'SAVE_GROUP_CODE_STATE'
  ORDER BY id DESC LIMIT 1
), saved AS (
  SELECT DISTINCT ON (upper(codes.value)) codes.key::int AS id, upper(codes.value) AS code
  FROM state, jsonb_each_text(COALESCE(state.saved->'courseCodes', '{}'::jsonb)) codes
  WHERE codes.key ~ '^[0-9]{1,9}$' AND codes.value ~ '^[A-Za-z0-9]{1,10}$'
  ORDER BY upper(codes.value), codes.key::int
)
UPDATE "academy_courses" course SET "short_code" = saved.code
FROM saved WHERE course.id = saved.id AND course.short_code IS NULL;
--> statement-breakpoint
UPDATE "academy_courses" course SET "short_code" = canonical.code
FROM (VALUES ('vibe-coding', 'VC'), ('ai-kids', 'AI')) AS canonical(slug, code)
WHERE course.slug = canonical.slug AND course.short_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM "academy_courses" other WHERE other.short_code = canonical.code);
--> statement-breakpoint
WITH used AS (
  SELECT course_id AS id, split_part(name, '-', 2) AS code, count(*) AS uses
  FROM "academy_groups"
  WHERE name ~ '^[A-Z0-9]+-[A-Z0-9]{1,10}-(GRP|IND)-[0-9]{2}-[0-9]+'
  GROUP BY course_id, split_part(name, '-', 2)
), best AS (
  SELECT DISTINCT ON (id) id, code FROM used ORDER BY id, uses DESC, code
), free AS (
  SELECT DISTINCT ON (best.code) best.id, best.code FROM best
  WHERE NOT EXISTS (SELECT 1 FROM "academy_courses" taken WHERE taken.short_code = best.code)
  ORDER BY best.code, best.id
)
UPDATE "academy_courses" course SET "short_code" = free.code
FROM free WHERE course.id = free.id AND course.short_code IS NULL;
--> statement-breakpoint
ALTER TABLE "academy_schools" ADD CONSTRAINT "academy_schools_short_code_format"
  CHECK ("short_code" IS NULL OR ("short_code" ~ '^[A-Z0-9]{1,10}$' AND "short_code" <> 'ONL'));
--> statement-breakpoint
ALTER TABLE "academy_courses" ADD CONSTRAINT "academy_courses_short_code_format"
  CHECK ("short_code" IS NULL OR "short_code" ~ '^[A-Z0-9]{1,10}$');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_schools_short_code_unique"
  ON "academy_schools" USING btree ("short_code") WHERE "short_code" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_courses_short_code_unique"
  ON "academy_courses" USING btree ("short_code") WHERE "short_code" IS NOT NULL;
--> statement-breakpoint
-- The sequence never goes back, so a number is never reused, even after a
-- group is deleted. It starts after every number already given out.
CREATE SEQUENCE IF NOT EXISTS "academy_group_code_seq" AS integer MINVALUE 1;
--> statement-breakpoint
WITH numbers AS (
  SELECT (regexp_match(name, '^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-[0-9]{2}-([0-9]+)'))[1]::numeric AS number
  FROM "academy_groups"
  UNION ALL
  SELECT (regexp_match(record->>'name', '^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-[0-9]{2}-([0-9]+)'))[1]::numeric
  FROM "audit_logs" audit
  CROSS JOIN LATERAL jsonb_array_elements(
    (CASE jsonb_typeof(audit.new_values::jsonb) WHEN 'array' THEN audit.new_values::jsonb
      WHEN 'object' THEN jsonb_build_array(audit.new_values::jsonb) ELSE '[]'::jsonb END)
    || (CASE jsonb_typeof(audit.old_values::jsonb) WHEN 'array' THEN audit.old_values::jsonb
      WHEN 'object' THEN jsonb_build_array(audit.old_values::jsonb) ELSE '[]'::jsonb END)
  ) AS saved_records(record)
  WHERE audit.entity_type IN ('academy_group', 'academy_groups')
  UNION ALL
  SELECT (new_values::jsonb->>'highWaterNumber')::numeric FROM "audit_logs"
  WHERE entity_type = 'academy_group_code_state' AND action = 'SAVE_GROUP_CODE_STATE'
    AND (new_values::jsonb->>'highWaterNumber') ~ '^[0-9]{1,9}$'
), high_water AS (
  SELECT LEAST(COALESCE(max(number), 0), 2000000000)::integer AS number FROM numbers WHERE number IS NOT NULL
)
SELECT setval('academy_group_code_seq', GREATEST(high_water.number, 1), high_water.number > 0) FROM high_water;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD COLUMN IF NOT EXISTS "delivery_mode" varchar(20) DEFAULT 'offline' NOT NULL;
--> statement-breakpoint
UPDATE "academy_groups" SET "delivery_mode" = 'online' WHERE name LIKE 'ONL-%' AND delivery_mode = 'offline';
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_delivery_mode_check"
  CHECK ("delivery_mode" IN ('offline', 'online'));
--> statement-breakpoint
ALTER TABLE "academy_groups" ALTER COLUMN "school_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_branch_required_offline"
  CHECK ("delivery_mode" = 'online' OR "school_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "academy_groups" DROP CONSTRAINT IF EXISTS "academy_groups_room_required_for_teaching";
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_room_required_for_teaching"
  CHECK ("status" = 'planned' OR "delivery_mode" = 'online' OR "room_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "academy_lessons" ALTER COLUMN "room_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD COLUMN IF NOT EXISTS "note" text;
--> statement-breakpoint
-- The teacher's lesson note used to be copied onto every pupil's mark. A note
-- that every mark of a lesson carries becomes the lesson's own note; a note on
-- only some marks is about those pupils and stays theirs. The copies stay on
-- the marks until the next release, so the previous image still shows them
-- after a rollback.
UPDATE "academy_lessons" lesson SET "note" = shared.note
FROM (
  SELECT lesson_id, min(btrim(note)) AS note
  FROM "academy_attendance"
  GROUP BY lesson_id
  HAVING bool_and(btrim(COALESCE(note, '')) <> '') AND count(DISTINCT btrim(note)) = 1
) shared
WHERE lesson.id = shared.lesson_id AND lesson.note IS NULL;
