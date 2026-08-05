ALTER TABLE "meta_lead_attributions"
  ADD COLUMN IF NOT EXISTS "thumbnail_url" text;

-- Existing rows were enriched before the creative thumbnail was collected, so the
-- worker would never revisit them. Queue them for one more enrichment pass; it also
-- picks up ad names that were renamed in Ads Manager after the first pass.
UPDATE "meta_lead_attributions"
SET "enrichment_status" = 'pending',
    "enrichment_attempts" = 0,
    "next_enrichment_at" = NOW(),
    "enrichment_error" = NULL,
    "updated_at" = NOW()
WHERE "enrichment_status" = 'enriched'
  AND "ad_id" IS NOT NULL
  AND "thumbnail_url" IS NULL;
