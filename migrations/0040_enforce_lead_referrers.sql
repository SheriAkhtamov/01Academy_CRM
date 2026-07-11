-- Remove legacy dangling references before enforcing the invariant.
UPDATE "academy_leads" AS leads
SET "referrer_student_id" = NULL,
    "updated_at" = NOW()
WHERE leads."referrer_student_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "academy_students" AS students
    WHERE students."id" = leads."referrer_student_id"
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'academy_leads_referrer_student_id_academy_students_id_fk'
      AND conrelid = 'academy_leads'::regclass
  ) THEN
    ALTER TABLE "academy_leads"
      ADD CONSTRAINT "academy_leads_referrer_student_id_academy_students_id_fk"
      FOREIGN KEY ("referrer_student_id")
      REFERENCES "academy_students"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "academy_leads_referrer_idx"
  ON "academy_leads" USING btree ("referrer_student_id");
