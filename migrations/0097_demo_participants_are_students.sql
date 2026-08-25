-- Demo attendance belongs to a concrete student, not to a sales lead. Backfill
-- every historical participant before removing the legacy lead reference.

ALTER TABLE "academy_demo_lesson_participants"
  ADD COLUMN IF NOT EXISTS "student_id" integer;

DO $$ BEGIN
  ALTER TABLE "academy_demo_lesson_participants"
    ADD CONSTRAINT "academy_demo_lesson_participants_student_id_fk"
    FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- A legacy lead participant cannot be assigned safely when the lead already
-- has several student profiles. Stop instead of silently attaching history to
-- the wrong child. Production data is checked before this migration is run.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM academy_demo_lesson_participants participant
    JOIN academy_students student ON student.lead_id = participant.lead_id
    GROUP BY participant.lead_id
    HAVING COUNT(DISTINCT student.id) > 1
  ) THEN
    RAISE EXCEPTION 'Ambiguous demo participant: a lead has multiple students';
  END IF;
END $$;

WITH missing_students AS (
  SELECT DISTINCT lead.id,
         lead.contact_name,
         lead.phone,
         lead.student_name,
         lead.student_age,
         COALESCE(lead.demo_course_id, lead.course_id) AS course_id,
         lead.school_id,
         lead.manager_id
  FROM academy_demo_lesson_participants participant
  JOIN academy_leads lead ON lead.id = participant.lead_id
  WHERE NOT EXISTS (
    SELECT 1 FROM academy_students student WHERE student.lead_id = lead.id
  )
), inserted_students AS (
  INSERT INTO academy_students (
    lead_id,
    contact_name,
    phone,
    student_name,
    student_age,
    course_id,
    school_id,
    manager_id,
    status,
    referral_code,
    risk_flags,
    created_at,
    updated_at
  )
  SELECT id,
         contact_name,
         phone,
         COALESCE(NULLIF(BTRIM(student_name), ''), contact_name),
         student_age,
         course_id,
         school_id,
         manager_id,
         'trial',
         'DEMO-' || id::text,
         '[]'::jsonb,
         NOW(),
         NOW()
  FROM missing_students
  RETURNING id
)
INSERT INTO academy_student_status_history (
  student_id,
  from_status,
  to_status,
  comment
)
SELECT id, NULL, 'trial', 'Создан миграцией участников демо-уроков'
FROM inserted_students;

UPDATE academy_demo_lesson_participants participant
SET student_id = student.id
FROM academy_students student
WHERE participant.lead_id = student.lead_id
  AND participant.student_id IS NULL;

ALTER TABLE "academy_demo_lesson_participants"
  ALTER COLUMN "student_id" SET NOT NULL;

DROP INDEX IF EXISTS "academy_demo_lesson_participants_unique";
DROP INDEX IF EXISTS "academy_demo_lesson_participants_lead_idx";

ALTER TABLE "academy_demo_lesson_participants"
  DROP CONSTRAINT IF EXISTS "academy_demo_lesson_participants_lead_id_fk";

ALTER TABLE "academy_demo_lesson_participants"
  DROP COLUMN IF EXISTS "lead_id";

CREATE UNIQUE INDEX IF NOT EXISTS "academy_demo_lesson_participants_unique"
  ON "academy_demo_lesson_participants" ("demo_lesson_id", "student_id");

CREATE INDEX IF NOT EXISTS "academy_demo_lesson_participants_student_idx"
  ON "academy_demo_lesson_participants" ("student_id", "demo_lesson_id");
