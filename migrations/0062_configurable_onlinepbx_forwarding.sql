ALTER TABLE "academy_company_settings"
  ADD COLUMN IF NOT EXISTS "online_pbx_forwarding_phone" varchar(32) NOT NULL DEFAULT '+998978576040';
--> statement-breakpoint
ALTER TABLE "academy_company_settings"
  ADD COLUMN IF NOT EXISTS "online_pbx_forwarding_enabled" boolean NOT NULL DEFAULT true;
