ALTER TABLE "academy_leads"
  ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_leads"
  ADD COLUMN IF NOT EXISTS "archive_reason" varchar(80);
--> statement-breakpoint
ALTER TABLE "academy_leads"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
ALTER TABLE "academy_leads"
  ADD COLUMN IF NOT EXISTS "archived_by" integer;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "academy_leads"
    ADD CONSTRAINT "academy_leads_archived_by_users_id_fk"
    FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_archive_idx"
  ON "academy_leads" USING btree ("is_archived", "archived_at");
