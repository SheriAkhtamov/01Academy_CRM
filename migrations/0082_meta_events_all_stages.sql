-- Stage events are no longer messaging-only: a lead-form conversion is matched by its
-- leadgen id and carries no messaging channel at all.
ALTER TABLE "meta_conversion_events"
  ALTER COLUMN "messaging_channel" DROP NOT NULL;

ALTER TABLE "meta_conversion_events"
  ADD COLUMN IF NOT EXISTS "match_key" varchar(40);

COMMENT ON COLUMN "meta_conversion_events"."match_key" IS
  'How Meta is asked to identify the person: ig_sid, leadgen_id or phone_hash.';
