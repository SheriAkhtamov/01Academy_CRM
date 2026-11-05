-- Platform overhaul, stage 1 (expand): the referral program, receivables (due
-- dates, covered periods, discounts, next payment dates), course prices, the
-- legacy academy_tasks table and the paused student status leave the
-- application. Their tables and columns are dropped by 0171 in the next
-- release, so the previous image keeps working if this release is rolled back.
-- A payment is only the record of money received for a pupil; the expected
-- payment of a pupil and a lead is kept on purpose.

-- New pupils no longer get a referral code.
ALTER TABLE "academy_students" ALTER COLUMN "referral_code" DROP NOT NULL;
--> statement-breakpoint

-- Receivables. An unpaid invoice without any proof of payment was only a debt
-- record. Debts are gone, so it is cancelled and kept as history. A pending
-- payment with a payment date or a receipt still waits for its confirmation.
UPDATE "academy_payments" payment
SET "status" = 'cancelled', "updated_at" = NOW()
WHERE payment."status" IN ('pending', 'overdue')
  AND payment."paid_at" IS NULL
  AND payment."receipt_url" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "academy_payment_attachments" attachment
    WHERE attachment."payment_id" = payment."id"
  );
--> statement-breakpoint
-- A payment has no due date any more, so it can no longer become overdue.
UPDATE "academy_payments" SET "status" = 'pending', "updated_at" = NOW() WHERE "status" = 'overdue';
--> statement-breakpoint

-- A pupil who leaves for a while is archived. Active memberships of an archived
-- pupil are suspended: the place in the group is free, the history is kept and
-- a restore can bring the pupil back to the same groups.
ALTER TABLE "academy_students"
  ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp,
  ADD COLUMN IF NOT EXISTS "archived_by" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'academy_students_archived_by_users_id_fk'
      AND conrelid = 'public.academy_students'::regclass
  ) THEN
    ALTER TABLE "academy_students"
      ADD CONSTRAINT "academy_students_archived_by_users_id_fk"
      FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_students_archive_idx"
  ON "academy_students" USING btree ("is_archived", "archived_at");
--> statement-breakpoint
ALTER TABLE "academy_student_group_enrollments"
  DROP CONSTRAINT IF EXISTS "academy_student_group_enrollments_status_check";
--> statement-breakpoint
ALTER TABLE "academy_student_group_enrollments"
  ADD CONSTRAINT "academy_student_group_enrollments_status_check"
  CHECK ("status" IN ('active', 'withdrawn', 'completed', 'suspended'));
--> statement-breakpoint
WITH paused AS (
  UPDATE "academy_students"
  SET "is_archived" = true,
      "archived_at" = COALESCE("updated_at", NOW()),
      "status" = 'studying',
      "group_id" = NULL,
      "updated_at" = NOW()
  WHERE "status" = 'paused'
  RETURNING "id"
), suspended AS (
  UPDATE "academy_student_group_enrollments" enrollment
  SET "status" = 'suspended',
      "ended_at" = GREATEST(NOW(), enrollment."enrolled_at"),
      "updated_at" = NOW()
  FROM paused
  WHERE enrollment."student_id" = paused."id" AND enrollment."status" = 'active'
  RETURNING enrollment."id"
)
-- Rosters and attendance read the status at the lesson time. An archived pupil
-- is not studying until a restore writes the next history entry.
INSERT INTO "academy_student_status_history" ("student_id", "from_status", "to_status", "comment")
SELECT paused."id", 'paused', 'archived', 'Пауза заменена архивом'
FROM paused;
--> statement-breakpoint

-- Sales KPI: a repeat sale is classified from the payment history instead of
-- being reviewed by hand. Only money that stayed paid counts as history, so a
-- refunded mistake recorded again is still the first sale. The balance after a
-- prepayment of the same course is an installment. A course the pupil never
-- paid for, while other courses were paid for, is an upsell. Further sales of
-- the course in the same month are installments; any other repeat sale is a
-- renewal. A payment without a group belongs to whatever course it covers.
CREATE OR REPLACE FUNCTION academy_kpi_sale_month(paid_at timestamp, created_at timestamp)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((COALESCE(paid_at, created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_kpi_repeat_sale_kind(
  target_id integer, target_student integer, target_group integer,
  target_paid_at timestamp, target_created_at timestamp
) RETURNS text LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT (SELECT sold.course_id FROM academy_groups sold WHERE sold.id = target_group) AS course_id,
      academy_kpi_sale_month(target_paid_at, target_created_at) AS sale_month
  ), earlier AS (
    SELECT payment.id, payment.type,
      (SELECT sold.course_id FROM academy_groups sold WHERE sold.id = payment.group_id) AS course_id,
      COALESCE(payment.paid_at, payment.created_at) AS sold_at,
      academy_kpi_sale_month(payment.paid_at, payment.created_at) AS sale_month
    FROM academy_payments payment
    WHERE payment.student_id = target_student AND payment.id <> target_id
      AND payment.amount_uzs > 0 AND payment.status = 'paid'
      AND (COALESCE(payment.paid_at, payment.created_at), payment.id)
        < (COALESCE(target_paid_at, target_created_at), target_id)
  ), same_course AS (
    SELECT earlier.* FROM earlier CROSS JOIN target
    WHERE target.course_id IS NULL OR earlier.course_id IS NULL OR earlier.course_id = target.course_id
  )
  SELECT CASE
    WHEN (SELECT same_course.type FROM same_course ORDER BY same_course.sold_at DESC, same_course.id DESC LIMIT 1)
      = 'prepayment' THEN 'installment'
    WHEN (SELECT target.course_id FROM target) IS NOT NULL
      AND EXISTS (SELECT 1 FROM earlier WHERE earlier.course_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM earlier CROSS JOIN target WHERE earlier.course_id = target.course_id) THEN 'upsell'
    WHEN EXISTS (SELECT 1 FROM same_course CROSS JOIN target WHERE same_course.sale_month = target.sale_month)
      THEN 'installment'
    ELSE 'renewal'
  END
$$;
--> statement-breakpoint
-- Only the open KPI month is classified. Unreviewed sales of closed months never
-- earned a bonus, and recalculating a closed month must not change its payroll.
UPDATE "academy_sales_kpi_sales" sale
SET "kind" = classified.kind,
    "cycle_key" = CASE WHEN classified.kind IN ('renewal', 'upsell') THEN classified.sale_month END
FROM (
  SELECT payment.id,
    CASE WHEN academy_kpi_sale_month(payment.paid_at, payment.created_at)
        = to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
      THEN academy_kpi_repeat_sale_kind(payment.id, payment.student_id, payment.group_id, payment.paid_at, payment.created_at)
      ELSE 'installment'
    END AS kind,
    academy_kpi_sale_month(payment.paid_at, payment.created_at) AS sale_month
  FROM academy_payments payment
  JOIN academy_sales_kpi_sales tracked ON tracked.payment_id = payment.id
  WHERE tracked.kind = 'unclassified'
) classified
WHERE sale."payment_id" = classified.id;
--> statement-breakpoint
ALTER TABLE "academy_sales_kpi_sales" DROP CONSTRAINT IF EXISTS "academy_sales_kpi_sales_kind_check";
--> statement-breakpoint
ALTER TABLE "academy_sales_kpi_sales"
  ADD CONSTRAINT "academy_sales_kpi_sales_kind_check"
  CHECK ("kind" IN ('new', 'renewal', 'upsell', 'installment'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_kpi_capture_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_lead integer;
  assigned_manager integer;
  attributed_closer integer;
  sale_kind text;
  prior_sale boolean;
BEGIN
  IF NEW.status <> 'paid' OR NEW.amount_uzs <= 0 OR NEW.student_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM academy_sales_kpi_sales WHERE payment_id = NEW.id) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('paid', 'refunded') THEN RETURN NEW; END IF;
  PERFORM 1 FROM academy_students WHERE id = NEW.student_id FOR UPDATE;
  SELECT COALESCE(NEW.lead_id, lead_id), manager_id INTO linked_lead, assigned_manager
    FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  SELECT closer_id INTO attributed_closer FROM academy_sales_kpi_leads WHERE lead_id = linked_lead;
  IF attributed_closer IS NULL AND academy_kpi_employee_role(assigned_manager) IN ('closer', 'full_cycle', 'full_cycle_3500') THEN
    attributed_closer := assigned_manager;
  END IF;
  SELECT EXISTS (SELECT 1 FROM academy_payments payment
    WHERE payment.student_id = NEW.student_id AND payment.id <> NEW.id
      AND payment.amount_uzs > 0 AND payment.status = 'paid') INTO prior_sale;
  -- A repeat sale dated in a closed KPI month never earns a bonus afterwards.
  sale_kind := CASE WHEN NEW.type = 'installment_2_2' THEN 'installment'
    WHEN NOT prior_sale THEN 'new'
    WHEN academy_kpi_sale_month(NEW.paid_at, NEW.created_at) < to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
      THEN 'installment'
    ELSE academy_kpi_repeat_sale_kind(NEW.id, NEW.student_id, NEW.group_id, NEW.paid_at, NEW.created_at) END;
  INSERT INTO academy_sales_kpi_sales (payment_id, closer_id, kind, cycle_key)
    VALUES (NEW.id, attributed_closer, sale_kind,
      CASE WHEN sale_kind IN ('renewal', 'upsell') THEN academy_kpi_sale_month(NEW.paid_at, NEW.created_at) END)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Correcting a wrong first payment must not lose the new pupil: when the only
-- first sale of a pupil is refunded, the earliest sale that stayed paid becomes
-- the first sale, unless it belongs to a closed KPI month. A second installment
-- is never a first sale, as at capture time.
CREATE OR REPLACE FUNCTION academy_kpi_reclassify_after_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  successor_id integer;
  successor_month text;
BEGIN
  IF OLD.status <> 'paid' OR NEW.status <> 'refunded' OR NEW.student_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM academy_sales_kpi_sales WHERE payment_id = NEW.id AND kind = 'new') THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM academy_sales_kpi_sales sale JOIN academy_payments payment ON payment.id = sale.payment_id
    WHERE payment.student_id = NEW.student_id AND payment.id <> NEW.id AND payment.status = 'paid' AND sale.kind = 'new'
  ) THEN RETURN NEW; END IF;
  SELECT payment.id, academy_kpi_sale_month(payment.paid_at, payment.created_at)
    INTO successor_id, successor_month
    FROM academy_payments payment JOIN academy_sales_kpi_sales sale ON sale.payment_id = payment.id
    WHERE payment.student_id = NEW.student_id AND payment.id <> NEW.id
      AND payment.status = 'paid' AND payment.amount_uzs > 0
      AND payment.type IS DISTINCT FROM 'installment_2_2'
    ORDER BY COALESCE(payment.paid_at, payment.created_at), payment.id
    LIMIT 1;
  IF successor_id IS NULL OR successor_month <> to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') THEN
    RETURN NEW;
  END IF;
  UPDATE academy_sales_kpi_sales SET kind = 'new', cycle_key = NULL WHERE payment_id = successor_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "academy_kpi_sale_refund" ON "academy_payments";
--> statement-breakpoint
CREATE TRIGGER "academy_kpi_sale_refund"
  AFTER UPDATE OF "status" ON "academy_payments"
  FOR EACH ROW EXECUTE FUNCTION academy_kpi_reclassify_after_refund();
