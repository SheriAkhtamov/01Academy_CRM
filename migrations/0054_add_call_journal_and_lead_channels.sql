INSERT INTO "academy_lead_sources"
  ("code", "name", "channel", "is_system", "is_active", "updated_at")
VALUES
  ('telephony', 'Телефония', 'call', true, true, NOW()),
  ('whatsapp', 'WhatsApp', 'whatsapp', true, true, NOW())
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "channel" = EXCLUDED."channel",
  "is_system" = true,
  "is_active" = true,
  "updated_at" = NOW();

CREATE TABLE IF NOT EXISTS "academy_lead_channels" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL REFERENCES "academy_leads"("id") ON DELETE CASCADE,
  "channel" varchar(40) NOT NULL,
  "provider_account_id" varchar(120) NOT NULL DEFAULT '',
  "external_id" varchar(255),
  "handle" varchar(255),
  "display_name" varchar(255),
  "profile_url" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "academy_lead_channels_channel_check"
    CHECK ("channel" ~ '^[a-z][a-z0-9_-]{1,39}$')
);

CREATE INDEX IF NOT EXISTS "academy_lead_channels_lead_idx"
  ON "academy_lead_channels" ("lead_id", "channel");

CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_channels_external_unique"
  ON "academy_lead_channels" ("channel", "provider_account_id", "external_id")
  WHERE "external_id" IS NOT NULL AND BTRIM("external_id") <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_channels_handle_unique"
  ON "academy_lead_channels" ("lead_id", "channel", "provider_account_id", LOWER("handle"))
  WHERE "handle" IS NOT NULL AND BTRIM("handle") <> '';

INSERT INTO "academy_lead_channels" (
  "lead_id", "channel", "provider_account_id", "external_id", "handle",
  "display_name", "profile_url", "metadata", "created_at", "updated_at"
)
SELECT DISTINCT ON (conversation.account_id, conversation.participant_igsid)
  conversation.lead_id,
  'instagram',
  account.ig_user_id,
  conversation.participant_igsid,
  NULLIF(REGEXP_REPLACE(COALESCE(conversation.participant_username, ''), '^@+', ''), ''),
  NULLIF(conversation.participant_name, ''),
  CASE
    WHEN NULLIF(REGEXP_REPLACE(COALESCE(conversation.participant_username, ''), '^@+', ''), '') IS NULL THEN NULL
    ELSE 'https://www.instagram.com/'
      || REGEXP_REPLACE(conversation.participant_username, '^@+', '') || '/'
  END,
  jsonb_build_object('conversationId', conversation.id),
  COALESCE(conversation.created_at, NOW()),
  NOW()
FROM "instagram_conversations" conversation
JOIN "instagram_accounts" account ON account.id = conversation.account_id
WHERE conversation.lead_id IS NOT NULL
ORDER BY conversation.account_id, conversation.participant_igsid,
         conversation.updated_at DESC NULLS LAST, conversation.id DESC
ON CONFLICT ("channel", "provider_account_id", "external_id")
  WHERE "external_id" IS NOT NULL AND BTRIM("external_id") <> ''
DO UPDATE SET
  "lead_id" = EXCLUDED."lead_id",
  "handle" = COALESCE(EXCLUDED."handle", "academy_lead_channels"."handle"),
  "display_name" = COALESCE(EXCLUDED."display_name", "academy_lead_channels"."display_name"),
  "profile_url" = COALESCE(EXCLUDED."profile_url", "academy_lead_channels"."profile_url"),
  "metadata" = "academy_lead_channels"."metadata" || EXCLUDED."metadata",
  "updated_at" = NOW();

INSERT INTO "academy_lead_channels" (
  "lead_id", "channel", "external_id", "handle", "profile_url", "metadata"
)
SELECT
  lead.id,
  LOWER(source.channel),
  CASE
    WHEN LOWER(source.channel) = 'instagram' AND LOWER(lead.messenger) LIKE 'instagram:%'
      THEN SUBSTRING(lead.messenger FROM LENGTH('instagram:') + 1)
    WHEN LOWER(source.channel) = 'whatsapp'
      THEN NULLIF(REGEXP_REPLACE(COALESCE(lead.phone, ''), '\D', '', 'g'), '')
    ELSE NULL
  END,
  CASE
    WHEN lead.messenger IS NULL OR LOWER(lead.messenger) LIKE 'instagram:%' THEN NULL
    ELSE REGEXP_REPLACE(
      REGEXP_REPLACE(lead.messenger, '^https?://(www\.)?(instagram\.com|t\.me)/', '', 'i'),
      '(^@+|/.*$)', '', 'g'
    )
  END,
  CASE
    WHEN LOWER(source.channel) = 'instagram' AND lead.messenger IS NOT NULL
      AND LOWER(lead.messenger) NOT LIKE 'instagram:%'
      THEN 'https://www.instagram.com/' || REGEXP_REPLACE(
        REGEXP_REPLACE(lead.messenger, '^https?://(www\.)?instagram\.com/', '', 'i'),
        '(^@+|/.*$)', '', 'g'
      ) || '/'
    WHEN LOWER(source.channel) = 'telegram' AND lead.messenger IS NOT NULL
      THEN 'https://t.me/' || REGEXP_REPLACE(
        REGEXP_REPLACE(lead.messenger, '^https?://(www\.)?t\.me/', '', 'i'),
        '(^@+|/.*$)', '', 'g'
      )
    WHEN LOWER(source.channel) = 'whatsapp' AND lead.phone IS NOT NULL
      THEN 'https://wa.me/' || REGEXP_REPLACE(lead.phone, '\D', '', 'g')
    ELSE NULL
  END,
  '{"backfilledFrom":"lead"}'::jsonb
FROM "academy_leads" lead
JOIN "academy_lead_sources" source ON source.id = lead.source_id
WHERE LOWER(COALESCE(source.channel, '')) IN ('instagram', 'telegram', 'whatsapp')
  AND (lead.messenger IS NOT NULL OR lead.phone IS NOT NULL)
ON CONFLICT DO NOTHING;

ALTER TABLE "telephony_calls"
  ADD COLUMN IF NOT EXISTS "lead_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'telephony_calls_lead_id_academy_leads_id_fk'
  ) THEN
    ALTER TABLE "telephony_calls"
      ADD CONSTRAINT "telephony_calls_lead_id_academy_leads_id_fk"
      FOREIGN KEY ("lead_id") REFERENCES "academy_leads"("id") ON DELETE SET NULL;
  END IF;
END $$;

UPDATE "telephony_calls" call
SET "lead_id" = CASE
  WHEN call.contact_type = 'lead' THEN call.contact_id
  WHEN call.contact_type = 'student' THEN student.lead_id
  ELSE NULL
END
FROM "academy_students" student
WHERE call.lead_id IS NULL
  AND call.contact_type = 'student'
  AND student.id = call.contact_id
  AND student.lead_id IS NOT NULL;

UPDATE "telephony_calls" call
SET "lead_id" = call.contact_id
WHERE call.lead_id IS NULL
  AND call.contact_type = 'lead'
  AND EXISTS (SELECT 1 FROM academy_leads lead WHERE lead.id = call.contact_id);

WITH matched_calls AS (
  SELECT DISTINCT ON (call.id)
    call.id AS call_id,
    phone.lead_id,
    lead.contact_name
  FROM telephony_calls call
  JOIN academy_lead_phones phone
    ON REGEXP_REPLACE(phone.normalized_phone, '\D', '', 'g')
      = REGEXP_REPLACE(call.phone, '\D', '', 'g')
  JOIN academy_leads lead ON lead.id = phone.lead_id
  WHERE call.lead_id IS NULL
  ORDER BY call.id, lead.is_archived, lead.updated_at DESC NULLS LAST, lead.id DESC
)
UPDATE "telephony_calls" call
SET "lead_id" = matched.lead_id,
    "contact_type" = COALESCE(call.contact_type, 'lead'),
    "contact_id" = COALESCE(call.contact_id, matched.lead_id),
    "contact_name" = COALESCE(call.contact_name, matched.contact_name)
FROM matched_calls matched
WHERE call.id = matched.call_id;

CREATE INDEX IF NOT EXISTS "telephony_calls_lead_started_idx"
  ON "telephony_calls" ("lead_id", "started_at" DESC);
