CREATE TABLE IF NOT EXISTS "academy_lead_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "author_id" integer,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "academy_lead_comments_lead_id_academy_leads_id_fk"
    FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "academy_lead_comments_author_id_users_id_fk"
    FOREIGN KEY ("author_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lead_comments_lead_created_idx"
  ON "academy_lead_comments" USING btree ("lead_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lead_comments_author_idx"
  ON "academy_lead_comments" USING btree ("author_id");
--> statement-breakpoint
INSERT INTO "academy_lead_comments" ("lead_id", "author_id", "body", "created_at")
SELECT
  lead."id",
  lead."created_by",
  BTRIM(lead."comment"),
  COALESCE(lead."updated_at", lead."created_at", NOW())
FROM "academy_leads" lead
WHERE NULLIF(BTRIM(lead."comment"), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "academy_lead_comments" existing
    WHERE existing."lead_id" = lead."id"
      AND existing."body" = BTRIM(lead."comment")
  );
