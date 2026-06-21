ALTER TABLE "users" ADD COLUMN "workspace" varchar(50);
--> statement-breakpoint
UPDATE "users"
SET "workspace" = CASE "role"
  WHEN 'admin' THEN 'administration'
  WHEN 'head' THEN 'administration'
  WHEN 'account_manager' THEN 'sales'
  WHEN 'teacher' THEN 'teacher'
  WHEN 'operations_director' THEN 'analytics'
  WHEN 'smm_manager' THEN 'marketing'
  ELSE 'management'
END;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "workspace" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_check"
CHECK ("users"."workspace" IN ('administration', 'sales', 'teacher', 'analytics', 'marketing', 'management'));
--> statement-breakpoint
CREATE INDEX "users_workspace_idx" ON "users" USING btree ("workspace");
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";
