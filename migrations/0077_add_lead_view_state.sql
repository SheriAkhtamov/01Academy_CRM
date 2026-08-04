ALTER TABLE "academy_leads"
  ADD COLUMN IF NOT EXISTS "first_viewed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "first_viewed_by" integer
    REFERENCES "users"("id") ON DELETE SET NULL;

--> statement-breakpoint
UPDATE "academy_leads"
SET "first_viewed_at" = COALESCE("updated_at", "created_at", NOW())
WHERE "first_viewed_at" IS NULL;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_unviewed_idx"
  ON "academy_leads" USING btree ("manager_id")
  WHERE "first_viewed_at" IS NULL AND COALESCE("is_archived", false) = false;
