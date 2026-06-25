DROP TABLE IF EXISTS "academy_payroll_entries";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "base_salary_uzs";
--> statement-breakpoint
ALTER TABLE "academy_teachers" DROP COLUMN IF EXISTS "rate_per_lesson_uzs";
--> statement-breakpoint
ALTER TABLE "academy_rooms" DROP COLUMN IF EXISTS "rent_per_hour_uzs";
--> statement-breakpoint
ALTER TABLE "academy_company_settings" DROP COLUMN IF EXISTS "sales_commission_percent";
--> statement-breakpoint
ALTER TABLE "academy_company_settings" DROP COLUMN IF EXISTS "group_min_fill_percent";
--> statement-breakpoint
ALTER TABLE "academy_company_settings" DROP COLUMN IF EXISTS "current_cash_balance_uzs";
