ALTER TABLE voice_reminder_settings
  ADD COLUMN day_before_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN day_before_start_time varchar(5) NOT NULL DEFAULT '10:00'
    CHECK (day_before_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN day_before_end_time varchar(5) NOT NULL DEFAULT '20:00'
    CHECK (day_before_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN day_before_intro_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD CONSTRAINT voice_reminder_settings_day_before_hours_check CHECK (day_before_start_time >= '10:00' AND day_before_end_time <= '20:00' AND day_before_start_time < day_before_end_time),
  ADD CONSTRAINT voice_reminder_settings_day_before_audio_check
    CHECK (NOT (enabled AND day_before_enabled) OR day_before_intro_audio_id IS NOT NULL);
ALTER TABLE voice_reminder_settings ALTER COLUMN lead_minutes SET DEFAULT 120;

-- Existing jobs keep their identities, attempts, leases and pinned recordings.
-- A reminder of the other kind is independent rather than a replay of that job.
ALTER TABLE voice_reminder_jobs ADD COLUMN reminder_kind varchar(20) NOT NULL DEFAULT 'same_day'
  CHECK (reminder_kind IN ('same_day','day_before'));
DO $$
DECLARE old_constraint record;
BEGIN
  FOR old_constraint IN SELECT conname FROM pg_constraint
    WHERE conrelid='voice_reminder_jobs'::regclass AND contype='u'
      AND pg_get_constraintdef(oid) LIKE '%demo_lesson_id%'
      AND pg_get_constraintdef(oid) LIKE '%participant_revision%'
  LOOP
    EXECUTE format('ALTER TABLE voice_reminder_jobs DROP CONSTRAINT %I',old_constraint.conname);
  END LOOP;
END;
$$;
DROP INDEX IF EXISTS voice_reminder_jobs_demo_participant_schedule_unique;
CREATE UNIQUE INDEX voice_reminder_jobs_demo_participant_schedule_unique ON voice_reminder_jobs
  (demo_lesson_id,participant_id,scheduled_at,lesson_revision,participant_revision,reminder_kind);
ALTER TABLE voice_reminder_test_calls ADD COLUMN reminder_kind varchar(20) NOT NULL DEFAULT 'same_day'
  CHECK (reminder_kind IN ('same_day','day_before'));

CREATE OR REPLACE FUNCTION validate_voice_reminder_audio_library() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration voice_reminder_settings%ROWTYPE;
DECLARE base_duration real;
DECLARE longest_hour real;
DECLARE longest_minute real;
BEGIN
  SELECT * INTO configuration FROM voice_reminder_settings WHERE id=1 FOR UPDATE;
  SELECT GREATEST(COALESCE(intro.duration_seconds,0),COALESCE(tomorrow_intro.duration_seconds,0)) + COALESCE(outro.duration_seconds,0)
    INTO base_duration FROM voice_reminder_settings settings
    LEFT JOIN voice_reminder_audio intro ON intro.id=settings.intro_audio_id
    LEFT JOIN voice_reminder_audio tomorrow_intro ON tomorrow_intro.id=settings.day_before_intro_audio_id
    LEFT JOIN voice_reminder_audio outro ON outro.id=settings.outro_audio_id WHERE settings.id=1;
  SELECT MAX(audio.duration_seconds) INTO longest_hour FROM voice_reminder_hour_audio entry
    JOIN voice_reminder_audio audio ON audio.id=entry.audio_id;
  SELECT MAX(audio.duration_seconds) INTO longest_minute FROM voice_reminder_minute_audio entry
    JOIN voice_reminder_audio audio ON audio.id=entry.audio_id;
  IF base_duration>180 OR base_duration+longest_hour+longest_minute>180
    OR EXISTS (SELECT 1 FROM voice_reminder_time_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id
      WHERE base_duration+audio.duration_seconds>180) THEN
    RAISE EXCEPTION 'voiceReminderAudioTooLong' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='voice_reminder_settings' AND configuration.enabled
    AND NOT EXISTS (SELECT 1 FROM voice_reminder_time_audio)
    AND NOT (EXISTS (SELECT 1 FROM voice_reminder_hour_audio) AND EXISTS (SELECT 1 FROM voice_reminder_minute_audio)) THEN
    IF TG_OP='INSERT' THEN
      RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE='23514';
    ELSIF NOT OLD.enabled THEN
      RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
