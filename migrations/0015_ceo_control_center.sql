CREATE TABLE IF NOT EXISTS "academy_company_settings" (
  "id" serial PRIMARY KEY,
  "target_revenue_monthly_uzs" integer NOT NULL DEFAULT 0,
  "target_new_leads_monthly" integer NOT NULL DEFAULT 0,
  "max_cac_uzs" integer NOT NULL DEFAULT 300000,
  "max_cpl_uzs" integer NOT NULL DEFAULT 0,
  "target_roas" integer NOT NULL DEFAULT 5,
  "target_attendance_percent" integer NOT NULL DEFAULT 70,
  "target_nps" integer NOT NULL DEFAULT 50,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "academy_company_settings" (
  "target_revenue_monthly_uzs", "target_new_leads_monthly", "max_cac_uzs", "max_cpl_uzs", "target_roas", "target_attendance_percent", "target_nps"
)
SELECT 0, 0, 300000, 0, 5, 70, 50
WHERE NOT EXISTS (SELECT 1 FROM "academy_company_settings");
--> statement-breakpoint
ALTER TABLE "academy_students" ADD COLUMN IF NOT EXISTS "exit_reason" varchar(80);
--> statement-breakpoint
ALTER TABLE "academy_payments" ADD COLUMN IF NOT EXISTS "refunded_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "academy_payments" ADD COLUMN IF NOT EXISTS "refunded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "academy_payments" ADD COLUMN IF NOT EXISTS "refund_comment" text;
--> statement-breakpoint
ALTER TABLE "academy_marketing_expenses" ADD COLUMN IF NOT EXISTS "status" varchar(50) NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "academy_marketing_expenses" ADD COLUMN IF NOT EXISTS "approved_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "academy_marketing_expenses" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "academy_marketing_expenses" ADD COLUMN IF NOT EXISTS "approval_comment" text;
--> statement-breakpoint
UPDATE "academy_marketing_expenses" SET "status" = 'approved' WHERE "status" IS NULL OR "status" = 'pending';
