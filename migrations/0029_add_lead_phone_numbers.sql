CREATE TABLE IF NOT EXISTS "academy_lead_phones" (
  "id" serial PRIMARY KEY,
  "lead_id" integer NOT NULL REFERENCES "academy_leads"("id") ON DELETE cascade,
  "phone" varchar(50) NOT NULL,
  "normalized_phone" varchar(50) NOT NULL,
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "academy_lead_phones_lead_idx"
  ON "academy_lead_phones" ("lead_id");

CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_phones_normalized_unique"
  ON "academy_lead_phones" ("normalized_phone");

WITH normalized AS (
  SELECT
    id AS lead_id,
    phone,
    regexp_replace(phone, '\D', '', 'g') AS digits
  FROM "academy_leads"
  WHERE phone IS NOT NULL AND btrim(phone) <> ''
),
prepared AS (
  SELECT
    lead_id,
    phone,
    CASE
      WHEN digits = '' THEN NULL
      WHEN length(digits) = 9 THEN '+998' || digits
      WHEN left(digits, 2) = '00' THEN '+' || substring(digits from 3)
      ELSE '+' || digits
    END AS normalized_phone
  FROM normalized
),
deduped AS (
  SELECT DISTINCT ON (normalized_phone)
    lead_id,
    phone,
    normalized_phone
  FROM prepared
  WHERE normalized_phone IS NOT NULL
  ORDER BY normalized_phone, lead_id
)
INSERT INTO "academy_lead_phones" ("lead_id", "phone", "normalized_phone", "is_primary")
SELECT lead_id, phone, normalized_phone, true
FROM deduped
ON CONFLICT ("normalized_phone") DO NOTHING;
