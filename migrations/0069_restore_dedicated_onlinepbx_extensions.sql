ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_online_pbx_extension_shared_check";
--> statement-breakpoint
DROP INDEX IF EXISTS "users_online_pbx_extension_idx";
--> statement-breakpoint
ALTER TABLE "users"
  ALTER COLUMN "online_pbx_extension" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users"
  ALTER COLUMN "online_pbx_extension" DROP DEFAULT;
--> statement-breakpoint
UPDATE "users"
SET "online_pbx_extension" = NULL,
    "updated_at" = NOW()
WHERE "online_pbx_extension" = '100';
--> statement-breakpoint
DELETE FROM "telephony_managed_extensions"
WHERE "provider" = 'onlinepbx'
  AND "extension" = '100';
--> statement-breakpoint
UPDATE "academy_company_settings"
SET "online_pbx_forwarding_enabled" = false,
    "updated_at" = NOW()
WHERE "online_pbx_forwarding_enabled" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_online_pbx_extension_unique"
  ON "users" ("online_pbx_extension")
  WHERE "online_pbx_extension" IS NOT NULL
    AND BTRIM("online_pbx_extension") <> '';
