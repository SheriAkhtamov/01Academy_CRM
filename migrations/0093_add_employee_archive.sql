-- Employee archive is a reversible offboarding state. It keeps historical
-- foreign-key references intact while preventing login and active assignment.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "archived_by" integer;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "archived_previous_is_active" boolean;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "archived_previous_online_pbx_incoming_enabled" boolean;

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_archived_by_users_id_fk"
    FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "users_archive_idx"
  ON "users" ("is_archived", "archived_at");
