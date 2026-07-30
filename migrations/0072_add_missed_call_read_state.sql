CREATE TABLE IF NOT EXISTS "telephony_missed_call_states" (
  "user_id" integer PRIMARY KEY
    REFERENCES "users"("id") ON DELETE CASCADE,
  "last_seen_call_id" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "telephony_missed_call_states_cursor_check"
    CHECK ("last_seen_call_id" >= 0)
);

INSERT INTO "telephony_missed_call_states" (
  "user_id",
  "last_seen_call_id",
  "updated_at"
)
SELECT
  "users"."id",
  COALESCE((SELECT MAX("telephony_calls"."id") FROM "telephony_calls"), 0),
  NOW()
FROM "users"
ON CONFLICT ("user_id") DO NOTHING;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "initialize_telephony_missed_call_state"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "telephony_missed_call_states" (
    "user_id",
    "last_seen_call_id",
    "updated_at"
  )
  SELECT
    NEW."id",
    COALESCE((SELECT MAX("telephony_calls"."id") FROM "telephony_calls"), 0),
    NOW()
  ON CONFLICT ("user_id") DO NOTHING;

  RETURN NEW;
END;
$$;

--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_initialize_telephony_missed_call_state"
  ON "users";

--> statement-breakpoint
CREATE TRIGGER "users_initialize_telephony_missed_call_state"
AFTER INSERT ON "users"
FOR EACH ROW
EXECUTE FUNCTION "initialize_telephony_missed_call_state"();
