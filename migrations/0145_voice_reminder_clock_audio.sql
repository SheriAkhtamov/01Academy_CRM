CREATE TABLE IF NOT EXISTS voice_reminder_hour_audio (
  hour varchar(2) PRIMARY KEY CHECK (hour ~ '^([01][0-9]|2[0-3])$'),
  audio_id uuid NOT NULL REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voice_reminder_minute_audio (
  minute varchar(2) PRIMARY KEY CHECK (minute ~ '^[0-5][0-9]$'),
  audio_id uuid NOT NULL REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE voice_reminder_jobs
  ADD COLUMN IF NOT EXISTS audio_mode varchar(10) CHECK (audio_mode IN ('time', 'clock')),
  ADD COLUMN IF NOT EXISTS hour_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS minute_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT;

-- Preserve already prepared and historical whole-clock pins. A later attempt
-- may select the preferred clock library without changing an active playback.
UPDATE voice_reminder_jobs SET audio_mode = 'time'
WHERE audio_mode IS NULL AND time_audio_id IS NOT NULL;
ALTER TABLE voice_reminder_jobs ADD CONSTRAINT voice_reminder_jobs_audio_parts_check CHECK (
  audio_mode IS NULL
  OR (audio_mode = 'time' AND time_audio_id IS NOT NULL AND hour_audio_id IS NULL AND minute_audio_id IS NULL)
  OR (audio_mode = 'clock' AND time_audio_id IS NULL AND hour_audio_id IS NOT NULL AND minute_audio_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION validate_voice_reminder_audio_library() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration voice_reminder_settings%ROWTYPE;
DECLARE base_duration real;
DECLARE longest_hour real;
DECLARE longest_minute real;
BEGIN
  SELECT * INTO configuration FROM voice_reminder_settings WHERE id = 1 FOR UPDATE;
  SELECT COALESCE(intro.duration_seconds, 0) + COALESCE(outro.duration_seconds, 0)
    INTO base_duration FROM voice_reminder_settings settings
    LEFT JOIN voice_reminder_audio intro ON intro.id = settings.intro_audio_id
    LEFT JOIN voice_reminder_audio outro ON outro.id = settings.outro_audio_id WHERE settings.id = 1;
  SELECT MAX(audio.duration_seconds) INTO longest_hour FROM voice_reminder_hour_audio entry
    JOIN voice_reminder_audio audio ON audio.id = entry.audio_id;
  SELECT MAX(audio.duration_seconds) INTO longest_minute FROM voice_reminder_minute_audio entry
    JOIN voice_reminder_audio audio ON audio.id = entry.audio_id;
  IF base_duration > 180 OR base_duration + longest_hour + longest_minute > 180
    OR EXISTS (SELECT 1 FROM voice_reminder_time_audio entry
      JOIN voice_reminder_audio audio ON audio.id = entry.audio_id WHERE base_duration + audio.duration_seconds > 180) THEN
    RAISE EXCEPTION 'voiceReminderAudioTooLong' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'voice_reminder_settings' AND configuration.enabled
    AND NOT EXISTS (SELECT 1 FROM voice_reminder_time_audio)
    AND NOT (EXISTS (SELECT 1 FROM voice_reminder_hour_audio) AND EXISTS (SELECT 1 FROM voice_reminder_minute_audio)) THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE = '23514';
    ELSIF NOT OLD.enabled THEN
      RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER validate_voice_reminder_hour_library AFTER INSERT OR UPDATE OR DELETE ON voice_reminder_hour_audio
  FOR EACH ROW EXECUTE FUNCTION validate_voice_reminder_audio_library();
CREATE TRIGGER validate_voice_reminder_minute_library AFTER INSERT OR UPDATE OR DELETE ON voice_reminder_minute_audio
  FOR EACH ROW EXECUTE FUNCTION validate_voice_reminder_audio_library();
