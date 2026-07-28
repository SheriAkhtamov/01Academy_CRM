CREATE TABLE IF NOT EXISTS "academy_lead_tags" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(64) NOT NULL,
  "normalized_name" varchar(64) NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT NOW() NOT NULL,
  "updated_at" timestamp DEFAULT NOW() NOT NULL,
  CONSTRAINT "academy_lead_tags_name_not_blank"
    CHECK (BTRIM("name") <> '' AND BTRIM("normalized_name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_tags_normalized_unique"
  ON "academy_lead_tags" ("normalized_name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lead_tag_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL
    REFERENCES "academy_leads"("id") ON DELETE CASCADE,
  "tag_id" integer NOT NULL
    REFERENCES "academy_lead_tags"("id") ON DELETE CASCADE,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_tag_assignments_lead_tag_unique"
  ON "academy_lead_tag_assignments" ("lead_id", "tag_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lead_tag_assignments_lead_idx"
  ON "academy_lead_tag_assignments" ("lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lead_tag_assignments_tag_idx"
  ON "academy_lead_tag_assignments" ("tag_id");
