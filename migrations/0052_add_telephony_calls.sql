CREATE TABLE IF NOT EXISTS "telephony_calls" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_call_id" varchar(255),
  "provider_call_id" varchar(120),
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "extension" varchar(20),
  "direction" varchar(20) NOT NULL,
  "status" varchar(40) NOT NULL,
  "phone" varchar(50) NOT NULL,
  "contact_type" varchar(30),
  "contact_id" integer,
  "contact_name" varchar(255),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "answered_at" timestamp,
  "ended_at" timestamp,
  "duration_seconds" integer NOT NULL DEFAULT 0,
  "talk_seconds" integer NOT NULL DEFAULT 0,
  "hangup_cause" varchar(120),
  "recording_url" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "telephony_calls_client_call_unique"
  ON "telephony_calls" ("client_call_id")
  WHERE "client_call_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "telephony_calls_provider_call_unique"
  ON "telephony_calls" ("provider_call_id")
  WHERE "provider_call_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "telephony_calls_user_started_idx"
  ON "telephony_calls" ("user_id", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "telephony_calls_phone_started_idx"
  ON "telephony_calls" ("phone", "started_at" DESC);
