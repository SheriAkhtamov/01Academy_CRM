ALTER TABLE "academy_referral_rewards"
  ADD COLUMN "qualified_by_payment_id" integer;

ALTER TABLE "academy_referral_rewards"
  ADD CONSTRAINT "academy_referral_rewards_qualified_by_payment_id_academy_payments_id_fk"
  FOREIGN KEY ("qualified_by_payment_id") REFERENCES "academy_payments"("id")
  ON DELETE set null;

CREATE INDEX "academy_referral_rewards_qualified_payment_idx"
  ON "academy_referral_rewards" USING btree ("qualified_by_payment_id");

CREATE TABLE "academy_referral_benefits" (
  "id" serial PRIMARY KEY NOT NULL,
  "student_id" integer NOT NULL,
  "benefit_type" varchar(80) NOT NULL,
  "status" varchar(30) DEFAULT 'pending' NOT NULL,
  "milestone" integer,
  "source_referral_count" integer,
  "source_referral_reward_id" integer,
  "source_payment_id" integer,
  "consumed_by_payment_id" integer,
  "granted_at" timestamp DEFAULT now(),
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "academy_referral_benefits_type_check"
    CHECK ("benefit_type" IN (
      'referred_first_payment_discount_15',
      'next_payment_discount_15',
      'free_month',
      'ai_ambassador_free_training'
    )),
  CONSTRAINT "academy_referral_benefits_status_check"
    CHECK ("status" IN ('pending', 'consumed', 'superseded')),
  CONSTRAINT "academy_referral_benefits_milestone_check"
    CHECK ("milestone" IS NULL OR "milestone" IN (1, 3, 5)),
  CONSTRAINT "academy_referral_benefits_type_milestone_check"
    CHECK (
      ("benefit_type" = 'referred_first_payment_discount_15' AND "milestone" IS NULL)
      OR (
        "milestone" IS NOT NULL
        AND (
          ("benefit_type" = 'next_payment_discount_15' AND "milestone" = 1)
          OR ("benefit_type" = 'free_month' AND "milestone" = 3)
          OR ("benefit_type" = 'ai_ambassador_free_training' AND "milestone" = 5)
        )
      )
    )
);

ALTER TABLE "academy_referral_benefits"
  ADD CONSTRAINT "academy_referral_benefits_student_id_academy_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "academy_students"("id")
  ON DELETE cascade;

ALTER TABLE "academy_referral_benefits"
  ADD CONSTRAINT "academy_referral_benefits_source_referral_reward_id_academy_referral_rewards_id_fk"
  FOREIGN KEY ("source_referral_reward_id") REFERENCES "academy_referral_rewards"("id")
  ON DELETE set null;

ALTER TABLE "academy_referral_benefits"
  ADD CONSTRAINT "academy_referral_benefits_source_payment_id_academy_payments_id_fk"
  FOREIGN KEY ("source_payment_id") REFERENCES "academy_payments"("id")
  ON DELETE set null;

ALTER TABLE "academy_referral_benefits"
  ADD CONSTRAINT "academy_referral_benefits_consumed_by_payment_id_academy_payments_id_fk"
  FOREIGN KEY ("consumed_by_payment_id") REFERENCES "academy_payments"("id")
  ON DELETE set null;

CREATE UNIQUE INDEX "academy_referral_benefits_student_type_unique"
  ON "academy_referral_benefits" USING btree ("student_id", "benefit_type");
CREATE INDEX "academy_referral_benefits_student_status_idx"
  ON "academy_referral_benefits" USING btree ("student_id", "status");
CREATE INDEX "academy_referral_benefits_status_idx"
  ON "academy_referral_benefits" USING btree ("status");

-- The previous implementation announced the 15% milestone but had no durable
-- entitlement. Preserve the promised benefit for existing qualified referrers.
WITH paid_referrals AS (
  SELECT
    rewards."referrer_student_id" AS student_id,
    COUNT(DISTINCT rewards."referred_student_id")::integer AS referral_count
  FROM "academy_referral_rewards" AS rewards
  WHERE rewards."status" = 'applied'
    AND rewards."referred_student_id" IS NOT NULL
  GROUP BY rewards."referrer_student_id"
)
INSERT INTO "academy_referral_benefits" (
  "student_id",
  "benefit_type",
  "status",
  "milestone",
  "source_referral_count"
)
SELECT
  paid_referrals.student_id,
  'next_payment_discount_15',
  'pending',
  1,
  paid_referrals.referral_count
FROM paid_referrals
WHERE paid_referrals.referral_count >= 1
ON CONFLICT ("student_id", "benefit_type") DO NOTHING;

-- Backfill exactly one free coverage payment for existing milestone-3
-- referrers that did not receive it from the legacy implementation.
WITH paid_referrals AS (
  SELECT
    rewards."referrer_student_id" AS student_id,
    COUNT(DISTINCT rewards."referred_student_id")::integer AS referral_count
  FROM "academy_referral_rewards" AS rewards
  WHERE rewards."status" = 'applied'
    AND rewards."referred_student_id" IS NOT NULL
  GROUP BY rewards."referrer_student_id"
)
INSERT INTO "academy_payments" (
  "student_id",
  "group_id",
  "amount_uzs",
  "type",
  "method",
  "paid_at",
  "period",
  "discount",
  "status",
  "paid_until",
  "comment"
)
SELECT
  students."id",
  students."group_id",
  0,
  'full',
  'transfer',
  NOW(),
  'referral_bonus',
  'referral_15',
  'paid',
  GREATEST(COALESCE(students."next_payment_at", NOW()), NOW()) + INTERVAL '30 days',
  'Бесплатный месяц по реферальной программе'
FROM paid_referrals
JOIN "academy_students" AS students ON students."id" = paid_referrals.student_id
WHERE paid_referrals.referral_count >= 3
  AND NOT EXISTS (
    SELECT 1
    FROM "academy_payments" AS payments
    WHERE payments."student_id" = students."id"
      AND payments."amount_uzs" = 0
      AND payments."status" = 'paid'
      AND payments."comment" = 'Бесплатный месяц по реферальной программе'
  );

-- A legacy free-month marker may exist without its coverage boundary. Repair
-- it before consuming the durable benefit so the entitlement is never lost.
WITH paid_referrals AS (
  SELECT
    rewards."referrer_student_id" AS student_id,
    COUNT(DISTINCT rewards."referred_student_id")::integer AS referral_count
  FROM "academy_referral_rewards" AS rewards
  WHERE rewards."status" = 'applied'
    AND rewards."referred_student_id" IS NOT NULL
  GROUP BY rewards."referrer_student_id"
)
UPDATE "academy_payments" AS payments
SET "paid_until" = GREATEST(COALESCE(students."next_payment_at", NOW()), NOW()) + INTERVAL '30 days',
    "updated_at" = NOW()
FROM paid_referrals
JOIN "academy_students" AS students ON students."id" = paid_referrals.student_id
WHERE paid_referrals.referral_count >= 3
  AND payments."student_id" = students."id"
  AND payments."amount_uzs" = 0
  AND payments."status" = 'paid'
  AND payments."comment" = 'Бесплатный месяц по реферальной программе'
  AND payments."paid_until" IS NULL;

WITH free_coverage AS (
  SELECT DISTINCT ON (payments."student_id")
    payments."student_id",
    payments."id" AS payment_id,
    payments."paid_until"
  FROM "academy_payments" AS payments
  WHERE payments."amount_uzs" = 0
    AND payments."status" = 'paid'
    AND payments."paid_until" IS NOT NULL
    AND payments."comment" = 'Бесплатный месяц по реферальной программе'
  ORDER BY payments."student_id", payments."created_at", payments."id"
),
paid_referrals AS (
  SELECT
    rewards."referrer_student_id" AS student_id,
    COUNT(DISTINCT rewards."referred_student_id")::integer AS referral_count
  FROM "academy_referral_rewards" AS rewards
  WHERE rewards."status" = 'applied'
    AND rewards."referred_student_id" IS NOT NULL
  GROUP BY rewards."referrer_student_id"
)
INSERT INTO "academy_referral_benefits" (
  "student_id",
  "benefit_type",
  "status",
  "milestone",
  "source_referral_count",
  "consumed_by_payment_id",
  "consumed_at"
)
SELECT
  paid_referrals.student_id,
  'free_month',
  'consumed',
  3,
  paid_referrals.referral_count,
  free_coverage.payment_id,
  NOW()
FROM paid_referrals
JOIN free_coverage ON free_coverage.student_id = paid_referrals.student_id
WHERE paid_referrals.referral_count >= 3
ON CONFLICT ("student_id", "benefit_type") DO NOTHING;

WITH paid_referrals AS (
  SELECT
    rewards."referrer_student_id" AS student_id,
    COUNT(DISTINCT rewards."referred_student_id")::integer AS referral_count
  FROM "academy_referral_rewards" AS rewards
  WHERE rewards."status" = 'applied'
    AND rewards."referred_student_id" IS NOT NULL
  GROUP BY rewards."referrer_student_id"
), free_coverage AS (
  SELECT payments."student_id", MAX(payments."paid_until") AS paid_until
  FROM "academy_payments" AS payments
  WHERE payments."amount_uzs" = 0
    AND payments."status" = 'paid'
    AND payments."comment" = 'Бесплатный месяц по реферальной программе'
  GROUP BY payments."student_id"
)
UPDATE "academy_students" AS students
SET "next_payment_at" = GREATEST(
      COALESCE(students."next_payment_at", free_coverage.paid_until),
      free_coverage.paid_until
    ),
    "updated_at" = NOW()
FROM free_coverage
JOIN paid_referrals ON paid_referrals.student_id = free_coverage.student_id
WHERE students."id" = free_coverage.student_id
  AND paid_referrals.referral_count >= 3
  AND free_coverage.paid_until IS NOT NULL;

-- AI Ambassador is a distinct pending training entitlement, not another free
-- month. It remains pending until a dedicated training redemption flow uses it.
WITH paid_referrals AS (
  SELECT
    rewards."referrer_student_id" AS student_id,
    COUNT(DISTINCT rewards."referred_student_id")::integer AS referral_count
  FROM "academy_referral_rewards" AS rewards
  WHERE rewards."status" = 'applied'
    AND rewards."referred_student_id" IS NOT NULL
  GROUP BY rewards."referrer_student_id"
)
INSERT INTO "academy_referral_benefits" (
  "student_id",
  "benefit_type",
  "status",
  "milestone",
  "source_referral_count"
)
SELECT
  paid_referrals.student_id,
  'ai_ambassador_free_training',
  'pending',
  5,
  paid_referrals.referral_count
FROM paid_referrals
WHERE paid_referrals.referral_count >= 5
ON CONFLICT ("student_id", "benefit_type") DO NOTHING;
