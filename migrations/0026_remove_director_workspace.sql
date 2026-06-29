WITH "director_users" AS (
  SELECT "id" AS "user_id"
  FROM "users"
  WHERE "workspace" = 'director'
  UNION
  SELECT "user_id"
  FROM "user_workspaces"
  WHERE "workspace" = 'director'
)
INSERT INTO "user_workspaces" ("user_id", "workspace")
SELECT "director_users"."user_id", "modules"."workspace"
FROM "director_users"
CROSS JOIN (
  VALUES
    ('administration'),
    ('sales'),
    ('teacher'),
    ('marketing')
) AS "modules"("workspace")
ON CONFLICT ("user_id", "workspace") DO NOTHING;
--> statement-breakpoint
UPDATE "users"
SET "workspace" = 'administration', "updated_at" = now()
WHERE "workspace" = 'director';
--> statement-breakpoint
DELETE FROM "user_workspaces"
WHERE "workspace" = 'director';
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_workspace_check";
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_workspace_check"
  CHECK ("users"."workspace" IN ('administration', 'sales', 'teacher', 'marketing'));
--> statement-breakpoint
ALTER TABLE "user_workspaces" DROP CONSTRAINT IF EXISTS "user_workspaces_workspace_check";
--> statement-breakpoint
ALTER TABLE "user_workspaces"
  ADD CONSTRAINT "user_workspaces_workspace_check"
  CHECK ("user_workspaces"."workspace" IN ('administration', 'sales', 'teacher', 'marketing'));
