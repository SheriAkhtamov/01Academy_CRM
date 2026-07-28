DROP INDEX IF EXISTS "users_online_pbx_extension_unique";

ALTER TABLE "academy_company_settings"
  ALTER COLUMN "online_pbx_forwarding_enabled" SET DEFAULT false;

UPDATE "users"
SET "online_pbx_extension" = NULL,
    "online_pbx_incoming_enabled" = false,
    "updated_at" = NOW()
WHERE "online_pbx_extension" IS NOT NULL
   OR "online_pbx_incoming_enabled" = true;

UPDATE "academy_company_settings"
SET "online_pbx_primary_manager_id" = NULL,
    "online_pbx_forwarding_enabled" = false,
    "updated_at" = NOW()
WHERE "online_pbx_primary_manager_id" IS NOT NULL
   OR "online_pbx_forwarding_enabled" = true;

DELETE FROM "telephony_managed_extensions"
WHERE "provider" = 'onlinepbx';
