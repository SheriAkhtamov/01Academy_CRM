ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "base_salary_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_teachers" ADD COLUMN IF NOT EXISTS "rate_per_lesson_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_rooms" ADD COLUMN IF NOT EXISTS "rent_per_hour_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "sales_commission_percent" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "group_min_fill_percent" integer NOT NULL DEFAULT 60;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "current_cash_balance_uzs" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "sales_phone_visibility" varchar(40) NOT NULL DEFAULT 'own_leads';
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "workday_start_hour" integer NOT NULL DEFAULT 8;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "workday_end_hour" integer NOT NULL DEFAULT 20;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "workdays" jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb;
--> statement-breakpoint
ALTER TABLE "academy_payments" ADD COLUMN IF NOT EXISTS "group_id" integer REFERENCES "academy_groups"("id") ON DELETE SET NULL;
--> statement-breakpoint
UPDATE "academy_payments" payment
SET "group_id" = COALESCE(
  (SELECT student."group_id" FROM "academy_students" student WHERE student."id" = payment."student_id"),
  (SELECT lead."enrolled_group_id" FROM "academy_leads" lead WHERE lead."id" = payment."lead_id")
)
WHERE payment."group_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payments_group_idx" ON "academy_payments" USING btree ("group_id");
--> statement-breakpoint
ALTER TABLE "academy_tasks" ADD COLUMN IF NOT EXISTS "escalated_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_payroll_entries" (
  "id" serial PRIMARY KEY,
  "period" varchar(7) NOT NULL,
  "entry_type" varchar(30) NOT NULL,
  "employee_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "teacher_id" integer REFERENCES "academy_teachers"("id") ON DELETE SET NULL,
  "employee_name" varchar(255) NOT NULL,
  "base_salary_uzs" integer NOT NULL DEFAULT 0,
  "commission_percent" integer NOT NULL DEFAULT 0,
  "commission_base_uzs" integer NOT NULL DEFAULT 0,
  "conducted_lessons" integer NOT NULL DEFAULT 0,
  "rate_per_lesson_uzs" integer NOT NULL DEFAULT 0,
  "amount_uzs" integer NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'pending',
  "paid_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payroll_entries_period_idx" ON "academy_payroll_entries" USING btree ("period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payroll_entries_user_idx" ON "academy_payroll_entries" USING btree ("employee_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payroll_entries_teacher_idx" ON "academy_payroll_entries" USING btree ("teacher_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_payroll_manager_period_unique" ON "academy_payroll_entries" USING btree ("period", "entry_type", "employee_user_id") WHERE "entry_type" = 'manager';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_payroll_teacher_period_unique" ON "academy_payroll_entries" USING btree ("period", "entry_type", "teacher_id") WHERE "entry_type" = 'teacher';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_escalation_events" (
  "id" serial PRIMARY KEY,
  "event_key" varchar(255) NOT NULL,
  "event_type" varchar(80) NOT NULL,
  "entity_type" varchar(80),
  "entity_id" integer,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_escalation_events_key_unique" ON "academy_escalation_events" USING btree ("event_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_escalation_events_type_idx" ON "academy_escalation_events" USING btree ("event_type");
