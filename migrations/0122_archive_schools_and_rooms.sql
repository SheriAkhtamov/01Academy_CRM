ALTER TABLE academy_schools
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_previous_is_active boolean;

ALTER TABLE academy_rooms
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_previous_is_active boolean;

DO $$ BEGIN
  ALTER TABLE academy_schools ADD CONSTRAINT academy_schools_archived_inactive
    CHECK (NOT is_archived OR NOT is_active);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE academy_rooms ADD CONSTRAINT academy_rooms_archived_inactive
    CHECK (NOT is_archived OR NOT is_active);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
