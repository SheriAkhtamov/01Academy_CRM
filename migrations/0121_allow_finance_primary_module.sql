ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_module_check";
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_module_check"
CHECK ("users"."module" IN ('administration', 'sales', 'teacher', 'marketing', 'finance'));
