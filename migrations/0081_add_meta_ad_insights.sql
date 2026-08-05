-- Daily spend per ad, so any reporting range can be summed without refetching Meta.
-- Amounts stay in the account currency (USD); conversion happens at read time.
CREATE TABLE IF NOT EXISTS "meta_ad_insights" (
  "id" serial PRIMARY KEY,
  "ad_id" varchar(120) NOT NULL,
  "stat_date" date NOT NULL,
  "spend" numeric(14, 4) NOT NULL DEFAULT 0,
  "impressions" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "reach" integer NOT NULL DEFAULT 0,
  "currency" varchar(10),
  "synced_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_insights_ad_date_unique"
  ON "meta_ad_insights" ("ad_id", "stat_date");
CREATE INDEX IF NOT EXISTS "meta_ad_insights_date_idx" ON "meta_ad_insights" ("stat_date");
