CREATE UNIQUE INDEX IF NOT EXISTS "users_online_pbx_extension_unique"
  ON "users" ("online_pbx_extension")
  WHERE "online_pbx_extension" IS NOT NULL
    AND BTRIM("online_pbx_extension") <> '';

CREATE TABLE IF NOT EXISTS "telephony_managed_extensions" (
  "extension" varchar(20) PRIMARY KEY NOT NULL,
  "provider" varchar(40) NOT NULL DEFAULT 'onlinepbx',
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

INSERT INTO "telephony_managed_extensions" ("extension", "provider")
SELECT DISTINCT BTRIM("online_pbx_extension"), 'onlinepbx'
FROM "users"
WHERE "online_pbx_extension" IS NOT NULL
  AND BTRIM("online_pbx_extension") <> ''
ON CONFLICT ("extension") DO NOTHING;

INSERT INTO "telephony_managed_extensions" ("extension", "provider")
VALUES ('109', 'onlinepbx')
ON CONFLICT ("extension") DO NOTHING;
