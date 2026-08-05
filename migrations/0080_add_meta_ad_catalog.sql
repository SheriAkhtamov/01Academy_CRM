-- Attribution rows only exist once an ad produced a lead, so an ad that ran without
-- results was invisible in the CRM. The catalog mirrors every ad in the account and
-- the attribution numbers are joined onto it.
CREATE TABLE IF NOT EXISTS "meta_ads" (
  "id" serial PRIMARY KEY,
  "ad_id" varchar(120) NOT NULL,
  "ad_name" varchar(500),
  "adset_id" varchar(120),
  "adset_name" varchar(500),
  "campaign_id" varchar(120),
  "campaign_name" varchar(500),
  "creative_id" varchar(120),
  "creative_name" varchar(500),
  "creative_title" text,
  "creative_body" text,
  "media_type" varchar(80),
  "hook_name" varchar(500),
  "thumbnail_url" text,
  "source_url" text,
  "effective_status" varchar(60),
  "ad_created_time" timestamp,
  "raw_payload" jsonb,
  "synced_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_ads_ad_id_unique" ON "meta_ads" ("ad_id");
CREATE INDEX IF NOT EXISTS "meta_ads_campaign_idx" ON "meta_ads" ("campaign_id");
CREATE INDEX IF NOT EXISTS "meta_ads_synced_idx" ON "meta_ads" ("synced_at");
