CREATE TABLE "academy_lead_group_reservations" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "group_id" integer NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "academy_lead_group_reservations"
  ADD CONSTRAINT "academy_lead_group_reservations_lead_id_academy_leads_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_lead_group_reservations"
  ADD CONSTRAINT "academy_lead_group_reservations_group_id_academy_groups_id_fk"
  FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_lead_group_reservations"
  ADD CONSTRAINT "academy_lead_group_reservations_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_lead_group_reservations_lead_idx"
  ON "academy_lead_group_reservations" USING btree ("lead_id");
--> statement-breakpoint
CREATE INDEX "academy_lead_group_reservations_group_idx"
  ON "academy_lead_group_reservations" USING btree ("group_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_lead_group_reservations_lead_group_unique"
  ON "academy_lead_group_reservations" USING btree ("lead_id", "group_id");
--> statement-breakpoint
INSERT INTO "academy_lead_group_reservations"
  ("lead_id", "group_id", "created_by", "created_at", "updated_at")
SELECT
  lead."id",
  lead."enrolled_group_id",
  lead."created_by",
  COALESCE(lead."created_at", NOW()),
  NOW()
FROM "academy_leads" lead
WHERE lead."enrolled_group_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "academy_students" student
    WHERE student."lead_id" = lead."id"
  )
ON CONFLICT ("lead_id", "group_id") DO NOTHING;
