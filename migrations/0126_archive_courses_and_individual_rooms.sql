ALTER TABLE academy_courses
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_previous_is_active boolean;

DO $$ BEGIN
  ALTER TABLE academy_courses ADD CONSTRAINT academy_courses_archived_inactive
    CHECK (NOT is_archived OR NOT is_active);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Existing room archives came from the school archive. Keep those restorable
-- while distinguishing future room archives made independently of the school.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'academy_rooms'::regclass AND attname = 'archived_by_school' AND NOT attisdropped
  ) THEN
    ALTER TABLE academy_rooms ADD COLUMN archived_by_school boolean NOT NULL DEFAULT false;
    UPDATE academy_rooms r SET archived_by_school = true
      FROM academy_schools s
      WHERE r.school_id = s.id AND r.is_archived AND s.is_archived;
  END IF;
END $$;
