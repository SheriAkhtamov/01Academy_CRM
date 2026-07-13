-- Internal CRM notifications belong to the current responsible employee.
-- Escalations were historically copied to every Administration user, while
-- lead notifications remained with the previous manager after reassignment.
-- Restore the task owner first, remove broadcast copies, then align every
-- notification that references a task, lead, or student with its current owner.
WITH source_notification AS (
  SELECT DISTINCT ON (task."id")
    task."id" AS task_id,
    task."responsible_id",
    notification."title",
    notification."message"
  FROM "academy_tasks" AS task
  JOIN "notifications" AS notification
    ON notification."type" = 'academy_escalation'
   AND notification."related_entity_type" = 'academy_task'
   AND notification."related_entity_id" = task."id"
  WHERE task."responsible_id" IS NOT NULL
  ORDER BY task."id", notification."created_at" DESC, notification."id" DESC
)
INSERT INTO "notifications"
  ("user_id", "type", "title", "message", "related_entity_type", "related_entity_id")
SELECT
  source_notification."responsible_id",
  'academy_escalation',
  source_notification."title",
  source_notification."message",
  'academy_task',
  source_notification."task_id"
FROM source_notification
JOIN "users" AS task_owner
  ON task_owner."id" = source_notification."responsible_id"
 AND task_owner."is_active" = true
WHERE NOT EXISTS (
  SELECT 1
  FROM "notifications" AS existing
  WHERE existing."user_id" = source_notification."responsible_id"
    AND existing."type" = 'academy_escalation'
    AND existing."related_entity_type" = 'academy_task'
    AND existing."related_entity_id" = source_notification."task_id"
);
--> statement-breakpoint

DELETE FROM "notifications" AS notification
USING "academy_tasks" AS task
WHERE notification."type" = 'academy_escalation'
  AND notification."related_entity_type" = 'academy_task'
  AND task."id" = notification."related_entity_id"
  AND notification."user_id" IS DISTINCT FROM task."responsible_id";
--> statement-breakpoint

UPDATE "notifications" AS notification
SET "user_id" = task."responsible_id", "is_read" = false
FROM "academy_tasks" AS task
JOIN "users" AS task_owner
  ON task_owner."id" = task."responsible_id"
 AND task_owner."is_active" = true
WHERE notification."related_entity_type" = 'academy_task'
  AND notification."related_entity_id" = task."id"
  AND notification."user_id" IS DISTINCT FROM task."responsible_id";
--> statement-breakpoint

DELETE FROM "notifications" AS notification
USING "academy_tasks" AS task
WHERE notification."related_entity_type" = 'academy_task'
  AND notification."related_entity_id" = task."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "users" AS task_owner
    WHERE task_owner."id" = task."responsible_id"
      AND task_owner."is_active" = true
  );
--> statement-breakpoint

UPDATE "notifications" AS notification
SET "user_id" = lead."manager_id", "is_read" = false
FROM "academy_leads" AS lead
JOIN "users" AS lead_owner
  ON lead_owner."id" = lead."manager_id"
 AND lead_owner."is_active" = true
WHERE notification."related_entity_type" = 'lead'
  AND notification."related_entity_id" = lead."id"
  AND notification."user_id" IS DISTINCT FROM lead."manager_id";
--> statement-breakpoint

DELETE FROM "notifications" AS notification
USING "academy_leads" AS lead
WHERE notification."related_entity_type" = 'lead'
  AND notification."related_entity_id" = lead."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "users" AS lead_owner
    WHERE lead_owner."id" = lead."manager_id"
      AND lead_owner."is_active" = true
  );
--> statement-breakpoint

UPDATE "notifications" AS notification
SET "user_id" = student."manager_id", "is_read" = false
FROM "academy_students" AS student
JOIN "users" AS student_owner
  ON student_owner."id" = student."manager_id"
 AND student_owner."is_active" = true
WHERE notification."related_entity_type" = 'student'
  AND notification."related_entity_id" = student."id"
  AND notification."user_id" IS DISTINCT FROM student."manager_id";
--> statement-breakpoint

DELETE FROM "notifications" AS notification
USING "academy_students" AS student
WHERE notification."related_entity_type" = 'student'
  AND notification."related_entity_id" = student."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "users" AS student_owner
    WHERE student_owner."id" = student."manager_id"
      AND student_owner."is_active" = true
  );
