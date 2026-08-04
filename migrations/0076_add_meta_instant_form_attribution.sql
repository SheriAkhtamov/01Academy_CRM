ALTER TABLE "meta_lead_attributions"
  ALTER COLUMN "conversation_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "meta_lead_attributions"
  ADD COLUMN IF NOT EXISTS "leadgen_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "form_id" varchar(255);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_lead_attributions_leadgen_touch_unique"
  ON "meta_lead_attributions" USING btree ("leadgen_id", "touch_type")
  WHERE "leadgen_id" IS NOT NULL AND BTRIM("leadgen_id") <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_lead_attributions_form_idx"
  ON "meta_lead_attributions" USING btree ("form_id");
