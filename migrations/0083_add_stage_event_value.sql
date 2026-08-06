-- Per-stage conversion value for Meta. Left NULL on purpose: a stage without an agreed
-- number sends no value at all, rather than teaching Meta that the stage is worth zero.
-- The paid stage ignores this and reports the real amount from the lead's payments.
ALTER TABLE "academy_lead_statuses"
  ADD COLUMN IF NOT EXISTS "meta_event_value" bigint;

ALTER TABLE "academy_lead_statuses"
  ADD CONSTRAINT "academy_lead_statuses_meta_event_value_check"
  CHECK ("meta_event_value" IS NULL OR "meta_event_value" >= 0);
