ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "sales_phone_visibility" varchar(40) NOT NULL DEFAULT 'own_leads';
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "workday_start_hour" integer NOT NULL DEFAULT 8;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "workday_end_hour" integer NOT NULL DEFAULT 20;
--> statement-breakpoint
ALTER TABLE "academy_company_settings" ADD COLUMN IF NOT EXISTS "workdays" jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb;
--> statement-breakpoint
ALTER TABLE "academy_payments" ADD COLUMN IF NOT EXISTS "group_id" integer REFERENCES "academy_groups"("id") ON DELETE SET NULL;
--> statement-breakpoint
UPDATE "academy_payments" payment
SET "group_id" = COALESCE(
  (SELECT student."group_id" FROM "academy_students" student WHERE student."id" = payment."student_id"),
  (SELECT lead."enrolled_group_id" FROM "academy_leads" lead WHERE lead."id" = payment."lead_id")
)
WHERE payment."group_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payments_group_idx" ON "academy_payments" USING btree ("group_id");
--> statement-breakpoint
ALTER TABLE "academy_tasks" ADD COLUMN IF NOT EXISTS "escalated_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_escalation_events" (
  "id" serial PRIMARY KEY,
  "event_key" varchar(255) NOT NULL,
  "event_type" varchar(80) NOT NULL,
  "entity_type" varchar(80),
  "entity_id" integer,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_escalation_events_key_unique" ON "academy_escalation_events" USING btree ("event_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_escalation_events_type_idx" ON "academy_escalation_events" USING btree ("event_type");
