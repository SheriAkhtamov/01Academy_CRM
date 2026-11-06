-- Platform overhaul, stage 2 (expand). A lead is qualified only by the explicit
-- criteria button, and a won deal leaves the active board without being
-- archived as lost. The tables this release stops using (drag-based funnel
-- qualifications, group reservations of leads, the lead's enrolled group) are
-- dropped one release later, so the previous image keeps working on rollback.

ALTER TABLE "academy_leads"
  ADD COLUMN IF NOT EXISTS "is_qualified" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "qualified_at" timestamp,
  ADD COLUMN IF NOT EXISTS "qualified_by" integer,
  ADD COLUMN IF NOT EXISTS "is_won" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "won_at" timestamp,
  ADD COLUMN IF NOT EXISTS "won_by" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_leads_qualified_by_users_id_fk'
      AND conrelid = 'public.academy_leads'::regclass) THEN
    ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_qualified_by_users_id_fk"
      FOREIGN KEY ("qualified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_leads_won_by_users_id_fk'
      AND conrelid = 'public.academy_leads'::regclass) THEN
    ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_won_by_users_id_fk"
      FOREIGN KEY ("won_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
-- The criteria button wrote per-funnel audit facts. The latest fact of every
-- funnel decides; a lead still qualified in any funnel keeps its earliest such
-- qualification. Moving a card out of the intake stage never counted.
WITH latest AS (
  SELECT DISTINCT ON (fact.entity_id, fact.new_values->0->>'funnelId')
    fact.entity_id AS lead_id, fact.action, fact.created_at, fact.user_id
  FROM "audit_logs" fact
  WHERE fact.entity_type = 'academy_lead'
    AND fact.action IN ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA', 'REVOKE_ACADEMY_LEAD_QUALIFICATION')
  ORDER BY fact.entity_id, fact.new_values->0->>'funnelId', fact.created_at DESC, fact.id DESC
), qualified AS (
  SELECT DISTINCT ON (lead_id) lead_id, created_at, user_id
  FROM latest
  WHERE action = 'QUALIFY_ACADEMY_LEAD_BY_CRITERIA'
  ORDER BY lead_id, created_at
)
UPDATE "academy_leads" lead
SET "is_qualified" = true,
    "qualified_at" = qualified.created_at,
    "qualified_by" = (SELECT account.id FROM "users" account WHERE account.id = qualified.user_id)
FROM qualified
WHERE lead.id = qualified.lead_id AND lead.is_qualified = false;
--> statement-breakpoint
-- Leads no longer book places in groups; only a pupil created inside the lead
-- joins one. A booking of an open lead without a pupil stays visible to its
-- manager as a comment on the lead.
INSERT INTO "academy_lead_comments" ("lead_id", "author_id", "body")
SELECT reservation.lead_id, NULL,
  'Бронь места в группе «' || academy_group.name || '» снята'
FROM "academy_lead_group_reservations" reservation
JOIN "academy_groups" academy_group ON academy_group.id = reservation.group_id
JOIN "academy_leads" lead ON lead.id = reservation.lead_id
WHERE COALESCE(lead.is_archived, false) = false
  AND NOT EXISTS (SELECT 1 FROM "academy_students" student WHERE student.lead_id = reservation.lead_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_qualified_idx"
  ON "academy_leads" USING btree ("qualified_at") WHERE "is_qualified";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_won_idx"
  ON "academy_leads" USING btree ("won_at") WHERE "is_won";
