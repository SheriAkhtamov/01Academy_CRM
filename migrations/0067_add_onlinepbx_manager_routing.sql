ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "online_pbx_incoming_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "users" AS manager
SET "online_pbx_incoming_enabled" = true,
    "updated_at" = NOW()
WHERE manager."is_active" = true
  AND (
    manager."workspace" = 'sales'
    OR EXISTS (
      SELECT 1
      FROM "user_workspaces" AS workspace
      WHERE workspace."user_id" = manager."id"
        AND workspace."workspace" = 'sales'
    )
  )
  AND length(regexp_replace(COALESCE(manager."phone", ''), '\D', '', 'g')) BETWEEN 7 AND 15
  AND regexp_replace(COALESCE(manager."phone", ''), '\D', '', 'g') <> '998787070171';
--> statement-breakpoint
ALTER TABLE "academy_company_settings"
  ADD COLUMN IF NOT EXISTS "online_pbx_primary_manager_id" integer
  REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
UPDATE "academy_company_settings" AS settings
SET "online_pbx_primary_manager_id" = (
  SELECT manager."id"
  FROM "users" AS manager
  WHERE manager."is_active" = true
    AND manager."online_pbx_incoming_enabled" = true
    AND (
      manager."workspace" = 'sales'
      OR EXISTS (
        SELECT 1
        FROM "user_workspaces" AS workspace
        WHERE workspace."user_id" = manager."id"
          AND workspace."workspace" = 'sales'
      )
    )
  ORDER BY (manager."workspace" = 'sales') DESC, manager."id"
  LIMIT 1
)
WHERE settings."online_pbx_primary_manager_id" IS NULL;
