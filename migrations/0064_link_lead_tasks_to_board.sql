ALTER TABLE "board_tasks"
  ADD COLUMN IF NOT EXISTS "lead_id" integer;
--> statement-breakpoint
ALTER TABLE "board_tasks"
  ADD COLUMN IF NOT EXISTS "legacy_academy_task_id" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'board_tasks_lead_id_academy_leads_id_fk'
      AND conrelid = 'public.board_tasks'::regclass
  ) THEN
    ALTER TABLE "board_tasks"
      ADD CONSTRAINT "board_tasks_lead_id_academy_leads_id_fk"
      FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_tasks_lead_idx"
  ON "board_tasks" USING btree ("lead_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_tasks_legacy_academy_task_unique"
  ON "board_tasks" USING btree ("legacy_academy_task_id")
  WHERE "legacy_academy_task_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "board_tasks" (
  "board_id",
  "title",
  "description",
  "status",
  "priority",
  "position",
  "creator_id",
  "assignee_id",
  "lead_id",
  "legacy_academy_task_id",
  "due_at",
  "created_at",
  "updated_at"
)
SELECT
  target_board."id",
  task."title",
  task."description",
  CASE
    WHEN task."status" = 'done' THEN 'done'
    WHEN task."status" = 'in_progress' THEN 'in_progress'
    ELSE 'backlog'
  END,
  'normal',
  ROW_NUMBER() OVER (
    PARTITION BY target_board."id", task."status"
    ORDER BY task."deadline_at" NULLS LAST, task."id"
  )::integer
    + COALESCE((
      SELECT MAX(existing."position")
      FROM "board_tasks" existing
      WHERE existing."board_id" = target_board."id"
    ), 0),
  task."responsible_id",
  task."responsible_id",
  task."entity_id",
  task."id",
  task."deadline_at",
  COALESCE(task."created_at", NOW()),
  COALESCE(task."updated_at", task."created_at", NOW())
FROM "academy_tasks" task
CROSS JOIN LATERAL (
  SELECT board."id"
  FROM "boards" board
  WHERE board."is_archived" = false
  ORDER BY board."is_default" DESC, board."id"
  LIMIT 1
) target_board
JOIN "academy_leads" lead ON lead."id" = task."entity_id"
WHERE task."entity_type" = 'lead'
  AND NOT EXISTS (
    SELECT 1
    FROM "board_tasks" existing
    WHERE existing."legacy_academy_task_id" = task."id"
  );
--> statement-breakpoint
INSERT INTO "board_task_activity" (
  "task_id",
  "actor_id",
  "type",
  "from_value",
  "to_value",
  "meta",
  "created_at"
)
SELECT
  task."id",
  task."creator_id",
  'created',
  NULL,
  task."status",
  jsonb_build_object('migratedFrom', 'academy_tasks'),
  task."created_at"
FROM "board_tasks" task
WHERE task."legacy_academy_task_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "board_task_activity" activity
    WHERE activity."task_id" = task."id"
      AND activity."type" = 'created'
  );
