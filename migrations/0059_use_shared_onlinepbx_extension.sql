DROP INDEX IF EXISTS "users_online_pbx_extension_unique";

ALTER TABLE "users"
  ALTER COLUMN "online_pbx_extension" SET DEFAULT '100';

UPDATE "users"
SET "online_pbx_extension" = '100',
    "updated_at" = NOW()
WHERE "online_pbx_extension" IS DISTINCT FROM '100';

ALTER TABLE "users"
  ALTER COLUMN "online_pbx_extension" SET NOT NULL;

ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_online_pbx_extension_shared_check";

ALTER TABLE "users"
  ADD CONSTRAINT "users_online_pbx_extension_shared_check"
  CHECK ("online_pbx_extension" = '100');

CREATE INDEX IF NOT EXISTS "users_online_pbx_extension_idx"
  ON "users" ("online_pbx_extension");

INSERT INTO "telephony_managed_extensions" ("extension", "provider", "updated_at")
VALUES ('100', 'onlinepbx', NOW())
ON CONFLICT ("extension") DO UPDATE
SET "provider" = EXCLUDED."provider",
    "updated_at" = NOW();

DELETE FROM "telephony_managed_extensions"
WHERE "provider" = 'onlinepbx'
  AND "extension" <> '100';
