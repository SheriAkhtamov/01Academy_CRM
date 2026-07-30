ALTER TABLE "users"
  RENAME COLUMN "workspace" TO "module";
--> statement-breakpoint
ALTER TABLE "user_workspaces"
  RENAME TO "user_modules";
--> statement-breakpoint
ALTER TABLE "user_modules"
  RENAME COLUMN "workspace" TO "module";
--> statement-breakpoint
ALTER INDEX IF EXISTS "users_workspace_idx"
  RENAME TO "users_module_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "user_workspaces_user_idx"
  RENAME TO "user_modules_user_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "user_workspaces_workspace_idx"
  RENAME TO "user_modules_module_idx";
--> statement-breakpoint
ALTER SEQUENCE IF EXISTS "user_workspaces_id_seq"
  RENAME TO "user_modules_id_seq";
--> statement-breakpoint
ALTER TABLE "users"
  RENAME CONSTRAINT "users_workspace_check" TO "users_module_check";
--> statement-breakpoint
ALTER TABLE "user_modules"
  RENAME CONSTRAINT "user_workspaces_pkey" TO "user_modules_pkey";
--> statement-breakpoint
ALTER TABLE "user_modules"
  RENAME CONSTRAINT "user_workspaces_user_id_fkey" TO "user_modules_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "user_modules"
  RENAME CONSTRAINT "user_workspaces_user_workspace_unique" TO "user_modules_user_module_unique";
--> statement-breakpoint
ALTER TABLE "user_modules"
  RENAME CONSTRAINT "user_workspaces_workspace_check" TO "user_modules_module_check";
