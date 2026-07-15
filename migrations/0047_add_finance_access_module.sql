ALTER TABLE "user_workspaces" DROP CONSTRAINT IF EXISTS "user_workspaces_workspace_check";
--> statement-breakpoint
ALTER TABLE "user_workspaces" ADD CONSTRAINT "user_workspaces_workspace_check"
CHECK ("user_workspaces"."workspace" IN ('administration', 'sales', 'teacher', 'marketing', 'finance'));
