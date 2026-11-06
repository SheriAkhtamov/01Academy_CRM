-- Platform overhaul, stage 4: teacher lesson and assistant lesson rates on salary rates,
-- relaxed amount check to allow zero base salary for hourly teachers,
-- and snapshot columns on academy_payroll_payouts for conducted lesson and assistant lesson counts and rates.

ALTER TABLE "academy_salary_rates" ADD COLUMN IF NOT EXISTS "lesson_rate_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_salary_rates" ADD COLUMN IF NOT EXISTS "assistant_lesson_rate_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_salary_rates" DROP CONSTRAINT IF EXISTS "academy_salary_rates_amount_check";
--> statement-breakpoint
ALTER TABLE "academy_salary_rates" ADD CONSTRAINT "academy_salary_rates_amount_check"
  CHECK ("amount_uzs" >= 0 AND "lesson_rate_uzs" >= 0 AND "assistant_lesson_rate_uzs" >= 0 AND ("amount_uzs" > 0 OR "lesson_rate_uzs" > 0 OR "assistant_lesson_rate_uzs" > 0));
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD COLUMN IF NOT EXISTS "conducted_lessons_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD COLUMN IF NOT EXISTS "lesson_rate_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD COLUMN IF NOT EXISTS "conducted_assistant_lessons_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD COLUMN IF NOT EXISTS "assistant_lesson_rate_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" DROP CONSTRAINT IF EXISTS "academy_payroll_payouts_amount_check";
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD CONSTRAINT "academy_payroll_payouts_amount_check"
  CHECK ("base_salary_uzs" >= 0 AND "bonus_uzs" >= 0 AND "deduction_uzs" >= 0
    AND "conducted_lessons_count" >= 0 AND "lesson_rate_uzs" >= 0
    AND "conducted_assistant_lessons_count" >= 0 AND "assistant_lesson_rate_uzs" >= 0
    AND "amount_uzs" >= 0
    AND "amount_uzs" = "base_salary_uzs" + ("conducted_lessons_count" * "lesson_rate_uzs") + ("conducted_assistant_lessons_count" * "assistant_lesson_rate_uzs") + "bonus_uzs" - "deduction_uzs");
