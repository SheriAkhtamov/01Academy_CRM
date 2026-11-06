-- Platform overhaul, stage 1 (contract). The release with 0170 stopped reading
-- and writing the referral program, receivables, course prices and the legacy
-- task table; this release drops them for good.

DROP TABLE IF EXISTS "academy_referral_benefits";
--> statement-breakpoint
DROP TABLE IF EXISTS "academy_referral_rewards";
--> statement-breakpoint
ALTER TABLE "academy_leads"
  DROP COLUMN IF EXISTS "referral_code",
  DROP COLUMN IF EXISTS "referrer_student_id";
--> statement-breakpoint
ALTER TABLE "academy_students"
  DROP COLUMN IF EXISTS "referral_code",
  DROP COLUMN IF EXISTS "referral_level";
--> statement-breakpoint
ALTER TABLE "academy_sales_kpi_sales" DROP COLUMN IF EXISTS "referral_initiated";
--> statement-breakpoint
ALTER TABLE "academy_payments"
  DROP COLUMN IF EXISTS "due_at",
  DROP COLUMN IF EXISTS "paid_until",
  DROP COLUMN IF EXISTS "discount",
  DROP COLUMN IF EXISTS "period";
--> statement-breakpoint
ALTER TABLE "academy_students"
  DROP COLUMN IF EXISTS "balance_uzs",
  DROP COLUMN IF EXISTS "next_payment_at";
--> statement-breakpoint
ALTER TABLE "academy_courses"
  DROP COLUMN IF EXISTS "base_price_uzs",
  DROP COLUMN IF EXISTS "discounted_price_uzs",
  DROP COLUMN IF EXISTS "ltv_target_min_uzs",
  DROP COLUMN IF EXISTS "ltv_target_max_uzs";
--> statement-breakpoint
-- Employee work lives on the shared task board.
DROP TABLE IF EXISTS "academy_tasks";
