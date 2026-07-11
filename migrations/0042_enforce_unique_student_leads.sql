-- Repair the duplicate student links introduced when migration 0033 moved an
-- Instagram lead onto a lead that already had a student. Educational history
-- stays on every student row; only the ambiguous lead_id link is detached.

-- Prevent a concurrent enrollment/task write from racing the repair and the
-- final unique-index validation. Reads remain available during the migration.
LOCK TABLE "academy_students" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE "academy_tasks" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

CREATE TEMP TABLE academy_student_lead_repairs ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    student."id" AS student_id,
    student."lead_id",
    student."status",
    FIRST_VALUE(student."id") OVER canonical_order AS canonical_student_id,
    ROW_NUMBER() OVER canonical_order AS duplicate_rank
  FROM "academy_students" AS student
  WHERE student."lead_id" IS NOT NULL
  WINDOW canonical_order AS (
    PARTITION BY student."lead_id"
    ORDER BY
      CASE WHEN student."status" = 'studying' THEN 0 ELSE 1 END,
      student."created_at" ASC NULLS LAST,
      student."id" ASC
  )
)
SELECT
  ranked.student_id AS duplicate_student_id,
  ranked.canonical_student_id,
  ranked.lead_id,
  ranked.status AS duplicate_status
FROM ranked
WHERE ranked.duplicate_rank > 1;
--> statement-breakpoint

INSERT INTO "audit_logs" (
  "action",
  "entity_type",
  "entity_id",
  "old_values",
  "new_values"
)
SELECT
  'academy_student_duplicate_lead_detached',
  'academy_student',
  repair.duplicate_student_id,
  jsonb_build_object(
    'leadId', repair.lead_id,
    'status', repair.duplicate_status
  ),
  jsonb_build_object(
    'leadId', NULL,
    'canonicalStudentId', repair.canonical_student_id,
    'reason', 'duplicate non-null academy_students.lead_id'
  )
FROM academy_student_lead_repairs AS repair;
--> statement-breakpoint

UPDATE "academy_students" AS student
SET "lead_id" = NULL,
    "updated_at" = NOW()
FROM academy_student_lead_repairs AS repair
WHERE student."id" = repair.duplicate_student_id
  AND student."lead_id" = repair.lead_id;
--> statement-breakpoint

-- Migration 0033 recorded every Instagram merge in audit_logs but did not
-- update generic lead tasks. Recover the mapping defensively: malformed audit
-- JSON is ignored and entity_id is a fallback for older valid audit rows.
CREATE TEMP TABLE instagram_lead_task_repair_map ON COMMIT DROP AS
WITH RECURSIVE raw_audits AS (
  SELECT
    audit."id" AS audit_id,
    audit."created_at",
    audit."old_values" ->> 'duplicateLeadId' AS duplicate_lead_text,
    audit."new_values" ->> 'retainedLeadId' AS canonical_lead_text,
    audit."entity_id" AS audit_entity_id
  FROM "audit_logs" AS audit
  WHERE audit."action" = 'instagram_lead_merged'
    AND audit."entity_type" = 'academy_lead'
), parsed_audits AS (
  SELECT
    raw_audits.audit_id,
    raw_audits.created_at,
    CASE
      WHEN raw_audits.duplicate_lead_text ~ '^[1-9][0-9]{0,9}$'
        THEN CASE
          WHEN raw_audits.duplicate_lead_text::numeric <= 2147483647
            THEN raw_audits.duplicate_lead_text::integer
          ELSE NULL
        END
      ELSE NULL
    END AS duplicate_lead_id,
    COALESCE(
      CASE
        WHEN raw_audits.canonical_lead_text ~ '^[1-9][0-9]{0,9}$'
          THEN CASE
            WHEN raw_audits.canonical_lead_text::numeric <= 2147483647
              THEN raw_audits.canonical_lead_text::integer
            ELSE NULL
          END
        ELSE NULL
      END,
      CASE
        WHEN raw_audits.audit_entity_id > 0 THEN raw_audits.audit_entity_id
        ELSE NULL
      END
    ) AS canonical_lead_id
  FROM raw_audits
), direct_map AS (
  SELECT DISTINCT ON (parsed_audits.duplicate_lead_id)
    parsed_audits.duplicate_lead_id,
    parsed_audits.canonical_lead_id
  FROM parsed_audits
  WHERE parsed_audits.duplicate_lead_id IS NOT NULL
    AND parsed_audits.canonical_lead_id IS NOT NULL
    AND parsed_audits.duplicate_lead_id <> parsed_audits.canonical_lead_id
  ORDER BY
    parsed_audits.duplicate_lead_id,
    parsed_audits.created_at DESC NULLS LAST,
    parsed_audits.audit_id DESC
), lead_paths AS (
  SELECT
    direct_map.duplicate_lead_id AS origin_duplicate_lead_id,
    direct_map.canonical_lead_id AS current_canonical_lead_id,
    ARRAY[direct_map.duplicate_lead_id, direct_map.canonical_lead_id] AS visited_lead_ids,
    1 AS path_depth
  FROM direct_map

  UNION ALL

  SELECT
    lead_paths.origin_duplicate_lead_id,
    next_map.canonical_lead_id,
    lead_paths.visited_lead_ids || next_map.canonical_lead_id,
    lead_paths.path_depth + 1
  FROM lead_paths
  JOIN direct_map AS next_map
    ON next_map.duplicate_lead_id = lead_paths.current_canonical_lead_id
  WHERE NOT next_map.canonical_lead_id = ANY(lead_paths.visited_lead_ids)
), resolved_paths AS (
  SELECT DISTINCT ON (lead_paths.origin_duplicate_lead_id)
    lead_paths.origin_duplicate_lead_id AS duplicate_lead_id,
    lead_paths.current_canonical_lead_id AS canonical_lead_id
  FROM lead_paths
  JOIN "academy_leads" AS canonical_lead
    ON canonical_lead."id" = lead_paths.current_canonical_lead_id
  ORDER BY lead_paths.origin_duplicate_lead_id, lead_paths.path_depth DESC
)
SELECT resolved_paths.duplicate_lead_id, resolved_paths.canonical_lead_id
FROM resolved_paths;
--> statement-breakpoint

UPDATE "academy_tasks" AS task
SET "entity_id" = repair.canonical_lead_id,
    "updated_at" = NOW()
FROM instagram_lead_task_repair_map AS repair
WHERE task."entity_type" = 'lead'
  AND task."entity_id" = repair.duplicate_lead_id
  AND task."entity_id" IS DISTINCT FROM repair.canonical_lead_id;
--> statement-breakpoint

-- Keep the stable earliest open task and close only exact duplicates among
-- lead entities affected by the merge repair.
CREATE TEMP TABLE academy_open_task_repairs ON COMMIT DROP AS
WITH affected_leads AS (
  SELECT DISTINCT repair.canonical_lead_id
  FROM instagram_lead_task_repair_map AS repair
), ranked AS (
  SELECT
    task."id" AS task_id,
    FIRST_VALUE(task."id") OVER task_order AS keeper_task_id,
    ROW_NUMBER() OVER task_order AS duplicate_rank
  FROM "academy_tasks" AS task
  JOIN affected_leads
    ON affected_leads.canonical_lead_id = task."entity_id"
  WHERE task."entity_type" = 'lead'
    AND task."status" <> 'done'
  WINDOW task_order AS (
    PARTITION BY
      task."entity_type",
      task."entity_id",
      task."title",
      task."responsible_id",
      task."description",
      task."deadline_at",
      task."status",
      task."completed_at",
      task."escalated_at"
    ORDER BY task."created_at" ASC NULLS LAST, task."id" ASC
  )
)
SELECT
  ranked.task_id AS duplicate_task_id,
  ranked.keeper_task_id
FROM ranked
WHERE ranked.duplicate_rank > 1;
--> statement-breakpoint

INSERT INTO "audit_logs" (
  "action",
  "entity_type",
  "entity_id",
  "old_values",
  "new_values"
)
SELECT
  'academy_task_duplicate_closed_after_lead_merge',
  'academy_task',
  task."id",
  jsonb_build_object(
    'status', task."status",
    'entityType', task."entity_type",
    'entityId', task."entity_id",
    'title', task."title",
    'responsibleId', task."responsible_id"
  ),
  jsonb_build_object(
    'status', 'done',
    'keeperTaskId', repair.keeper_task_id
  )
FROM academy_open_task_repairs AS repair
JOIN "academy_tasks" AS task ON task."id" = repair.duplicate_task_id;
--> statement-breakpoint

UPDATE "academy_tasks" AS task
SET "status" = 'done',
    "completed_at" = COALESCE(task."completed_at", NOW()),
    "updated_at" = NOW()
FROM academy_open_task_repairs AS repair
WHERE task."id" = repair.duplicate_task_id
  AND task."status" <> 'done';
--> statement-breakpoint

-- The partial predicate permits students created without a lead while making
-- one student per linked lead a database-enforced invariant.
DROP INDEX IF EXISTS "academy_students_lead_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "academy_students_lead_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_students_lead_unique"
  ON "academy_students" USING btree ("lead_id")
  WHERE "lead_id" IS NOT NULL;
