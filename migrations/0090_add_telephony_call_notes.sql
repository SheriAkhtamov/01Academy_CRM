-- Lets a manager write down the outcome of a call without leaving the phone
-- widget. The note belongs to the conversation rather than to the lead: an
-- unknown number may not have a lead yet, and a lead with a dozen calls needs
-- to say which one the note is about.

ALTER TABLE "telephony_calls"
  ADD COLUMN IF NOT EXISTS "note" text;

ALTER TABLE "telephony_calls"
  ADD COLUMN IF NOT EXISTS "note_author_id" integer
    REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "telephony_calls"
  ADD COLUMN IF NOT EXISTS "note_updated_at" timestamp;
