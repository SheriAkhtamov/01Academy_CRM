ALTER TABLE voice_reminder_settings
  ADD COLUMN IF NOT EXISTS intro_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS outro_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS voice_reminder_time_audio (
  time varchar(5) PRIMARY KEY CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  audio_id uuid NOT NULL REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE voice_reminder_jobs
  ADD COLUMN IF NOT EXISTS intro_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS time_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS outro_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS audio_clock_time varchar(5) CHECK (audio_clock_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Existing single-file settings do not authorize a modular reminder. Keep the
-- old asset and history while requiring the new parts to be configured first.
UPDATE voice_reminder_settings SET enabled = false, updated_at = now()
WHERE enabled AND (intro_audio_id IS NULL OR outro_audio_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM voice_reminder_time_audio));

DO $$
DECLARE old_constraint record;
BEGIN
  FOR old_constraint IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'voice_reminder_settings'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%enabled%'
      AND pg_get_constraintdef(oid) LIKE '%audio_id%'
  LOOP
    EXECUTE format('ALTER TABLE voice_reminder_settings DROP CONSTRAINT %I', old_constraint.conname);
  END LOOP;
END;
$$;

ALTER TABLE voice_reminder_settings ADD CONSTRAINT voice_reminder_settings_modular_audio_check
  CHECK (NOT enabled OR (intro_audio_id IS NOT NULL AND outro_audio_id IS NOT NULL));

CREATE OR REPLACE FUNCTION validate_voice_reminder_audio_library() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration voice_reminder_settings%ROWTYPE;
DECLARE base_duration real;
BEGIN
  SELECT * INTO configuration FROM voice_reminder_settings WHERE id = 1 FOR UPDATE;
  SELECT COALESCE(intro.duration_seconds, 0) + COALESCE(outro.duration_seconds, 0)
    INTO base_duration FROM voice_reminder_settings settings
    LEFT JOIN voice_reminder_audio intro ON intro.id = settings.intro_audio_id
    LEFT JOIN voice_reminder_audio outro ON outro.id = settings.outro_audio_id WHERE settings.id = 1;
  IF base_duration > 180 OR EXISTS (SELECT 1 FROM voice_reminder_time_audio entry
    JOIN voice_reminder_audio audio ON audio.id = entry.audio_id WHERE base_duration + audio.duration_seconds > 180) THEN
    RAISE EXCEPTION 'voiceReminderAudioTooLong' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'voice_reminder_settings' AND configuration.enabled
    AND NOT EXISTS (SELECT 1 FROM voice_reminder_time_audio) THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE = '23514';
    ELSIF NOT OLD.enabled THEN
      RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS validate_voice_reminder_settings_library ON voice_reminder_settings;
CREATE TRIGGER validate_voice_reminder_settings_library AFTER INSERT OR UPDATE ON voice_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION validate_voice_reminder_audio_library();
DROP TRIGGER IF EXISTS validate_voice_reminder_time_library ON voice_reminder_time_audio;
CREATE TRIGGER validate_voice_reminder_time_library AFTER INSERT OR UPDATE OR DELETE ON voice_reminder_time_audio
  FOR EACH ROW EXECUTE FUNCTION validate_voice_reminder_audio_library();
