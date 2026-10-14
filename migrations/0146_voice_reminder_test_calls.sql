CREATE TABLE voice_reminder_test_calls (
  id uuid PRIMARY KEY,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  phone varchar(20) NOT NULL CHECK (phone ~ '^[+][1-9][0-9]{7,14}$'),
  clock_time varchar(5) NOT NULL CHECK (clock_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  status varchar(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','calling','played','unanswered','failed','cancelled')),
  not_before_at timestamptz,
  expires_at timestamptz NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  audio_mode varchar(10) CHECK (audio_mode IN ('time','clock')),
  intro_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  time_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  outro_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  hour_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  minute_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  provider_call_id varchar(160),
  dial_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'calling' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'calling' AND lease_token IS NULL AND lease_until IS NULL)),
  CHECK (audio_mode IS NULL
    OR (audio_mode = 'time' AND intro_audio_id IS NOT NULL AND outro_audio_id IS NOT NULL
      AND time_audio_id IS NOT NULL AND hour_audio_id IS NULL AND minute_audio_id IS NULL)
    OR (audio_mode = 'clock' AND intro_audio_id IS NOT NULL AND outro_audio_id IS NOT NULL
      AND time_audio_id IS NULL AND hour_audio_id IS NOT NULL AND minute_audio_id IS NOT NULL))
);
CREATE UNIQUE INDEX voice_reminder_test_calls_actor_active_unique ON voice_reminder_test_calls(actor_user_id)
  WHERE status IN ('waiting','calling');
CREATE INDEX voice_reminder_test_calls_due_idx ON voice_reminder_test_calls(status,not_before_at,expires_at);
CREATE INDEX voice_reminder_test_calls_actor_current_idx ON voice_reminder_test_calls(actor_user_id,created_at DESC);

ALTER TABLE telephony_line_reservations ADD COLUMN test_call_id uuid REFERENCES voice_reminder_test_calls(id) ON DELETE SET NULL;
ALTER TABLE voice_reminder_call_attempts ADD COLUMN test_call_id uuid REFERENCES voice_reminder_test_calls(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX voice_reminder_call_attempts_test_unique ON voice_reminder_call_attempts(test_call_id)
  WHERE test_call_id IS NOT NULL;
