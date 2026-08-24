-- Store demo absence reasons as stable analytics codes instead of overloading
-- the free-form result field. Existing no-show rows remain valid and can be
-- classified the next time a manager edits them.

ALTER TABLE "academy_demo_lesson_participants"
  ADD COLUMN IF NOT EXISTS "no_show_reason_code" varchar(40);

ALTER TABLE "academy_demo_lesson_participants"
  ADD COLUMN IF NOT EXISTS "no_show_reason_note" text;

DO $$ BEGIN
  ALTER TABLE "academy_demo_lesson_participants"
    ADD CONSTRAINT "academy_demo_lesson_participants_no_show_reason_code_check"
    CHECK (
      "no_show_reason_code" IS NULL
      OR "no_show_reason_code" IN (
        'no_contact',
        'forgot',
        'reschedule_requested',
        'illness_or_emergency',
        'could_not_reach_location',
        'technical_issue',
        'not_interested',
        'other'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "academy_demo_lesson_participants"
    ADD CONSTRAINT "academy_demo_lesson_participants_no_show_reason_state_check"
    CHECK (
      "status" = 'no_show'
      OR ("no_show_reason_code" IS NULL AND "no_show_reason_note" IS NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "academy_demo_lesson_participants"
    ADD CONSTRAINT "academy_demo_lesson_participants_no_show_reason_note_length_check"
    CHECK (
      "no_show_reason_note" IS NULL
      OR char_length("no_show_reason_note") <= 500
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
