DROP INDEX IF EXISTS "academy_students_lead_unique";

CREATE INDEX IF NOT EXISTS "academy_students_lead_idx"
  ON "academy_students" ("lead_id");

CREATE TABLE IF NOT EXISTS "academy_lead_import_records" (
  "id" serial PRIMARY KEY,
  "provider" varchar(80) NOT NULL,
  "external_id" varchar(255) NOT NULL,
  "lead_id" integer REFERENCES "academy_leads"("id") ON DELETE set null,
  "source_sheet" varchar(255),
  "outcome" varchar(40) NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "imported_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "academy_lead_import_records_outcome_check"
    CHECK ("outcome" IN ('created', 'merged', 'merged_archived', 'skipped_test', 'skipped_invalid'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_import_records_provider_external_unique"
  ON "academy_lead_import_records" ("provider", "external_id");

CREATE INDEX IF NOT EXISTS "academy_lead_import_records_lead_idx"
  ON "academy_lead_import_records" ("lead_id");

-- Preserve already enrolled legacy leads before the lead form stops exposing
-- student fields. Qualified leads remain contacts until a student is created
-- explicitly; enrolled/paid leads represent real learners and are backfilled.
INSERT INTO "academy_students" (
  "lead_id",
  "group_id",
  "contact_name",
  "phone",
  "messenger",
  "student_name",
  "student_age",
  "course_id",
  "school_id",
  "manager_id",
  "status",
  "enrolled_at",
  "enrollment_date",
  "next_payment_at",
  "referral_code",
  "risk_flags",
  "created_at",
  "updated_at"
)
SELECT
  lead."id",
  lead."enrolled_group_id",
  lead."contact_name",
  lead."phone",
  lead."messenger",
  COALESCE(NULLIF(BTRIM(lead."student_name"), ''), lead."contact_name"),
  lead."student_age",
  lead."course_id",
  lead."school_id",
  lead."manager_id",
  'studying',
  COALESCE(lead."updated_at", lead."created_at", now()),
  COALESCE(lead."updated_at", lead."created_at", now()),
  CASE WHEN lead."status_code" = 'paid' THEN now() + interval '30 days' ELSE NULL END,
  'MIGRATED-LEAD-' || lead."id"::text,
  '[]'::jsonb,
  COALESCE(lead."created_at", now()),
  now()
FROM "academy_leads" lead
WHERE NOT EXISTS (
  SELECT 1 FROM "academy_students" student WHERE student."lead_id" = lead."id"
)
AND (
  lead."status_code" IN ('enrolled', 'paid')
  OR lead."enrolled_group_id" IS NOT NULL
);

INSERT INTO "academy_student_group_enrollments" (
  "student_id",
  "group_id",
  "status",
  "is_primary",
  "enrolled_at",
  "created_at",
  "updated_at"
)
SELECT
  student."id",
  student."group_id",
  'active',
  true,
  COALESCE(student."enrolled_at", student."created_at", now()),
  now(),
  now()
FROM "academy_students" student
WHERE student."group_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "academy_student_group_enrollments" enrollment
    WHERE enrollment."student_id" = student."id"
      AND enrollment."group_id" = student."group_id"
      AND enrollment."status" = 'active'
  )
ON CONFLICT ("student_id", "group_id") WHERE "status" = 'active' DO NOTHING;

UPDATE "academy_payments" payment
SET "student_id" = student."id",
    "updated_at" = now()
FROM "academy_students" student
WHERE payment."student_id" IS NULL
  AND payment."lead_id" = student."lead_id"
  AND NOT EXISTS (
    SELECT 1
    FROM "academy_students" other_student
    WHERE other_student."lead_id" = student."lead_id"
      AND other_student."id" <> student."id"
  );

INSERT INTO "academy_student_status_history" (
  "student_id",
  "from_status",
  "to_status",
  "comment",
  "created_at"
)
SELECT
  student."id",
  NULL,
  student."status",
  'Перенесено из исторической карточки лида',
  COALESCE(student."created_at", now())
FROM "academy_students" student
WHERE NOT EXISTS (
  SELECT 1
  FROM "academy_student_status_history" history
  WHERE history."student_id" = student."id"
);

DELETE FROM "academy_lead_group_reservations" reservation
WHERE EXISTS (
  SELECT 1
  FROM "academy_students" student
  WHERE student."lead_id" = reservation."lead_id"
);
