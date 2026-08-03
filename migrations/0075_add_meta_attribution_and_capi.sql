CREATE TABLE IF NOT EXISTS "meta_lead_attributions" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer,
  "conversation_id" integer NOT NULL,
  "provider" varchar(40) DEFAULT 'meta' NOT NULL,
  "channel" varchar(40) DEFAULT 'instagram' NOT NULL,
  "touch_type" varchar(40) DEFAULT 'first_touch' NOT NULL,
  "ad_id" varchar(120),
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
  "placement" varchar(120),
  "referral_source" varchar(120),
  "referral_type" varchar(120),
  "referral_ref" text,
  "source_url" text,
  "utm_source" varchar(500),
  "utm_medium" varchar(500),
  "utm_campaign" varchar(500),
  "utm_content" varchar(500),
  "utm_term" varchar(500),
  "utm_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "utm_derived" boolean DEFAULT false NOT NULL,
  "raw_payload" jsonb,
  "enrichment_status" varchar(30) DEFAULT 'pending' NOT NULL,
  "enrichment_attempts" integer DEFAULT 0 NOT NULL,
  "next_enrichment_at" timestamp DEFAULT now() NOT NULL,
  "enriched_at" timestamp,
  "enrichment_error" text,
  "captured_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_lead_attributions_touch_type_check" CHECK ("touch_type" IN ('first_touch')),
  CONSTRAINT "meta_lead_attributions_enrichment_status_check" CHECK (
    "enrichment_status" IN ('pending', 'processing', 'enriched', 'failed', 'not_required')
  ),
  CONSTRAINT "meta_lead_attributions_enrichment_attempts_check" CHECK ("enrichment_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_conversion_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer,
  "attribution_id" integer,
  "event_id" varchar(255) NOT NULL,
  "event_name" varchar(120) NOT NULL,
  "crm_stage" varchar(80) NOT NULL,
  "event_time" timestamp NOT NULL,
  "action_source" varchar(80) DEFAULT 'business_messaging' NOT NULL,
  "messaging_channel" varchar(40) DEFAULT 'instagram' NOT NULL,
  "user_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "custom_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(30) DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "last_attempt_at" timestamp,
  "sent_at" timestamp,
  "response_payload" jsonb,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_conversion_events_status_check" CHECK (
    "status" IN ('pending', 'processing', 'sent', 'failed')
  ),
  CONSTRAINT "meta_conversion_events_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_lead_attributions" ADD CONSTRAINT "meta_lead_attributions_lead_id_academy_leads_id_fk"
 FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_lead_attributions" ADD CONSTRAINT "meta_lead_attributions_conversation_id_instagram_conversations_id_fk"
 FOREIGN KEY ("conversation_id") REFERENCES "public"."instagram_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_lead_id_academy_leads_id_fk"
 FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_attribution_id_meta_lead_attributions_id_fk"
 FOREIGN KEY ("attribution_id") REFERENCES "public"."meta_lead_attributions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_lead_attributions_conversation_touch_unique"
  ON "meta_lead_attributions" USING btree ("conversation_id", "touch_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_lead_attributions_lead_idx"
  ON "meta_lead_attributions" USING btree ("lead_id", "captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_lead_attributions_ad_idx"
  ON "meta_lead_attributions" USING btree ("ad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_lead_attributions_enrichment_idx"
  ON "meta_lead_attributions" USING btree ("enrichment_status", "next_enrichment_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_conversion_events_event_unique"
  ON "meta_conversion_events" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_conversion_events_lead_idx"
  ON "meta_conversion_events" USING btree ("lead_id", "event_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_conversion_events_dispatch_idx"
  ON "meta_conversion_events" USING btree ("status", "next_attempt_at");
