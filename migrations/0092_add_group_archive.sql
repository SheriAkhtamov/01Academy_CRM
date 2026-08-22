-- A finished course never left the teacher's screen. `completed` is a lifecycle
-- status, not a shelf: an ended group kept its card in "My groups" and its past
-- lessons in the weekly schedule and the attendance calendar forever, so the
-- teacher scrolled through years of dead courses to reach the live ones.
-- The archive is now a flag of its own, separate from the status and reversible,
-- so a group can be marked completed today and shelved whenever the teacher is
-- actually done with it.

ALTER TABLE "academy_groups"
  ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL;

ALTER TABLE "academy_groups"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

ALTER TABLE "academy_groups"
  ADD COLUMN IF NOT EXISTS "archived_by" integer;

DO $$ BEGIN
  ALTER TABLE "academy_groups"
    ADD CONSTRAINT "academy_groups_archived_by_users_id_fk"
    FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "academy_groups_archive_idx"
  ON "academy_groups" ("is_archived", "archived_at");

-- Until now the administration screen called every completed group archived and
-- listed it under "Group archive". Those rows keep that meaning instead of
-- resurfacing as active work on the day this migration runs.
UPDATE "academy_groups"
SET "is_archived" = true,
    "archived_at" = COALESCE("archived_at", "updated_at", "created_at", NOW())
WHERE "status" = 'completed'
  AND "is_archived" = false;
