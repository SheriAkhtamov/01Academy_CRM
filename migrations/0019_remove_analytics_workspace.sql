UPDATE "users"
SET "workspace" = 'administration'
WHERE "workspace" = 'analytics';
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_workspace_check";
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_check"
CHECK ("users"."workspace" IN ('administration', 'sales', 'teacher', 'marketing'));
