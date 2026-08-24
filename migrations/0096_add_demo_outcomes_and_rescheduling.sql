ALTER TABLE "academy_demo_lessons" DROP CONSTRAINT IF EXISTS "academy_demo_lessons_status_check";

ALTER TABLE "academy_demo_lessons"
  ADD COLUMN IF NOT EXISTS "not_conducted_reason_code" varchar(50),
  ADD COLUMN IF NOT EXISTS "not_conducted_reason_note" text,
  ADD COLUMN IF NOT EXISTS "finalized_at" timestamp,
  ADD COLUMN IF NOT EXISTS "finalized_by" integer,
  ADD COLUMN IF NOT EXISTS "last_rescheduled_from" timestamp,
  ADD COLUMN IF NOT EXISTS "last_reschedule_reason" text,
  ADD COLUMN IF NOT EXISTS "last_rescheduled_at" timestamp,
  ADD COLUMN IF NOT EXISTS "last_rescheduled_by" integer;

ALTER TABLE "academy_demo_lessons"
  ADD CONSTRAINT "academy_demo_lessons_status_check"
    CHECK ("status" IN ('scheduled', 'completed', 'not_conducted', 'cancelled')),
  ADD CONSTRAINT "academy_demo_lessons_not_conducted_reason_code_check"
    CHECK ("not_conducted_reason_code" IS NULL OR "not_conducted_reason_code" IN ('teacher_unavailable', 'participants_absent', 'client_requested_change', 'room_unavailable', 'technical_issue', 'organizational_issue', 'emergency', 'other')),
  ADD CONSTRAINT "academy_demo_lessons_not_conducted_reason_state_check"
    CHECK (("status" = 'not_conducted' AND "not_conducted_reason_code" IS NOT NULL) OR ("status" <> 'not_conducted' AND "not_conducted_reason_code" IS NULL AND "not_conducted_reason_note" IS NULL)),
  ADD CONSTRAINT "academy_demo_lessons_not_conducted_other_note_check"
    CHECK ("not_conducted_reason_code" <> 'other' OR NULLIF(BTRIM("not_conducted_reason_note"), '') IS NOT NULL),
  ADD CONSTRAINT "academy_demo_lessons_not_conducted_reason_note_length_check"
    CHECK ("not_conducted_reason_note" IS NULL OR char_length("not_conducted_reason_note") <= 500),
  ADD CONSTRAINT "academy_demo_lessons_reschedule_reason_length_check"
    CHECK ("last_reschedule_reason" IS NULL OR char_length("last_reschedule_reason") <= 500),
  ADD CONSTRAINT "academy_demo_lessons_finalized_by_users_id_fk"
    FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "academy_demo_lessons_last_rescheduled_by_users_id_fk"
    FOREIGN KEY ("last_rescheduled_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
