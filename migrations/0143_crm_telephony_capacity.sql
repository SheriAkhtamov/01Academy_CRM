ALTER TABLE telephony_line_reservations
  ADD COLUMN IF NOT EXISTS dial_authorized_at timestamptz;

-- Before the explicit dial authorization endpoint existed, an existing manager
-- reservation may already have been dialled. Upgrade it conservatively.
UPDATE telephony_line_reservations
SET dial_authorized_at = created_at
WHERE owner_type = 'manager' AND dial_authorized_at IS NULL;

ALTER TABLE voice_reminder_call_attempts
  ADD COLUMN IF NOT EXISTS termination_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS voice_reminder_call_attempts_unresolved_idx
  ON voice_reminder_call_attempts (started_at)
  WHERE termination_confirmed_at IS NULL;
