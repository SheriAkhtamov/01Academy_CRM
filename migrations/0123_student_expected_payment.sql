ALTER TABLE academy_students
  ADD COLUMN IF NOT EXISTS expected_payment_uzs integer;

DO $$ BEGIN
  ALTER TABLE academy_students ADD CONSTRAINT academy_students_expected_payment_nonnegative
    CHECK (expected_payment_uzs IS NULL OR expected_payment_uzs >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A lead amount can be assigned unambiguously only when it has one student.
-- Keep the original lead amounts, including families with multiple students.
UPDATE academy_students student
SET expected_payment_uzs = lead.expected_payment_uzs
FROM academy_leads lead
WHERE student.lead_id = lead.id
  AND student.expected_payment_uzs IS NULL
  AND lead.expected_payment_uzs >= 0
  AND (SELECT COUNT(*) FROM academy_students sibling WHERE sibling.lead_id = lead.id) = 1;
