-- Platform overhaul, stage 2 (contract). The release with 0172 stopped using
-- drag-based funnel qualifications, lead group bookings and the lead's
-- enrolled group; this release drops them.

-- The release with 0172 is live, so a deploy rollback returns to an image that
-- already keeps academy_leads.is_qualified itself; nothing needs re-syncing.
DROP TABLE IF EXISTS "academy_lead_funnel_qualifications";
--> statement-breakpoint
DROP TABLE IF EXISTS "academy_lead_group_reservations";
--> statement-breakpoint
ALTER TABLE "academy_leads" DROP COLUMN IF EXISTS "enrolled_group_id";
--> statement-breakpoint
-- A deal is either won or lost, never both.
UPDATE "academy_leads" SET "is_won" = false, "won_at" = NULL, "won_by" = NULL WHERE "is_won" AND "is_archived";
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_leads_won_not_archived'
      AND conrelid = 'public.academy_leads'::regclass) THEN
    ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_won_not_archived"
      CHECK (NOT ("is_won" AND "is_archived"));
  END IF;
END $$;
