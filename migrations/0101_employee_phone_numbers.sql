CREATE TABLE IF NOT EXISTS "user_phones" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "phone" varchar(50) NOT NULL,
  "normalized_phone" varchar(50) NOT NULL,
  "sort_order" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_phones_user_idx"
  ON "user_phones" ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "user_phones_user_phone_unique"
  ON "user_phones" ("user_id", "normalized_phone");

CREATE UNIQUE INDEX IF NOT EXISTS "user_phones_user_sort_order_unique"
  ON "user_phones" ("user_id", "sort_order");

INSERT INTO "user_phones" ("user_id", "phone", "normalized_phone", "sort_order")
SELECT "id", "phone", regexp_replace("phone", '[^0-9]', '', 'g'), 0
FROM "users"
WHERE COALESCE(BTRIM("phone"), '') <> ''
ON CONFLICT ("user_id", "normalized_phone") DO NOTHING;
