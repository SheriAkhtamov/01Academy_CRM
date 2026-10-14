ALTER TABLE voice_reminder_settings
  ADD COLUMN confirmation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmation_yes_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN confirmation_no_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD CONSTRAINT voice_reminder_settings_confirmation_audio_check CHECK (
    NOT confirmation_enabled OR (confirmation_yes_audio_id IS NOT NULL AND confirmation_no_audio_id IS NOT NULL));

ALTER TABLE academy_demo_lessons ADD COLUMN voice_response_revision integer NOT NULL DEFAULT 0 CHECK (voice_response_revision>=0);
ALTER TABLE academy_demo_lesson_participants ADD COLUMN voice_response_revision integer NOT NULL DEFAULT 0 CHECK (voice_response_revision>=0);

CREATE FUNCTION revise_demo_voice_responses() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
    OR (NEW.status='cancelled') IS DISTINCT FROM (OLD.status='cancelled')
    OR (NEW.status='scheduled' AND OLD.status<>'scheduled') THEN
    NEW.voice_response_revision := OLD.voice_response_revision+1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER revise_demo_voice_responses BEFORE UPDATE OF scheduled_at,status ON academy_demo_lessons
  FOR EACH ROW EXECUTE FUNCTION revise_demo_voice_responses();
CREATE FUNCTION revise_participant_voice_responses() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.demo_lesson_id IS DISTINCT FROM OLD.demo_lesson_id
    OR (NEW.status='cancelled') IS DISTINCT FROM (OLD.status='cancelled')
    OR (NEW.status IN ('invited','confirmed') AND OLD.status NOT IN ('invited','confirmed')) THEN
    NEW.voice_response_revision := OLD.voice_response_revision+1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER revise_participant_voice_responses BEFORE UPDATE OF student_id,demo_lesson_id,status ON academy_demo_lesson_participants
  FOR EACH ROW EXECUTE FUNCTION revise_participant_voice_responses();

ALTER TABLE voice_reminder_jobs
  ADD COLUMN confirmation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmation_yes_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN confirmation_no_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN response_lesson_revision integer,
  ADD COLUMN response_participant_revision integer,
  ADD COLUMN response varchar(3) CONSTRAINT voice_reminder_jobs_response_value_check CHECK (response IN ('yes','no')),
  ADD COLUMN response_at timestamptz,
  ADD COLUMN response_call_id varchar(160),
  ADD CONSTRAINT voice_reminder_jobs_response_check CHECK (
    (response IS NULL AND response_at IS NULL AND response_call_id IS NULL)
    OR (response IS NOT NULL AND response_at IS NOT NULL AND response_call_id IS NOT NULL)),
  ADD CONSTRAINT voice_reminder_jobs_confirmation_pins_check CHECK (
    NOT confirmation_enabled OR (confirmation_yes_audio_id IS NOT NULL AND confirmation_no_audio_id IS NOT NULL));
ALTER TABLE voice_reminder_test_calls
  ADD COLUMN confirmation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN confirmation_yes_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN confirmation_no_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN response varchar(3) CONSTRAINT voice_reminder_test_calls_response_value_check CHECK (response IN ('yes','no')),
  ADD COLUMN response_at timestamptz,
  ADD COLUMN response_call_id varchar(160),
  ADD CONSTRAINT voice_reminder_test_calls_response_check CHECK (
    (response IS NULL AND response_at IS NULL AND response_call_id IS NULL)
    OR (response IS NOT NULL AND response_at IS NOT NULL AND response_call_id IS NOT NULL)),
  ADD CONSTRAINT voice_reminder_test_calls_confirmation_pins_check CHECK (
    NOT confirmation_enabled OR (confirmation_yes_audio_id IS NOT NULL AND confirmation_no_audio_id IS NOT NULL));
CREATE INDEX voice_reminder_jobs_response_idx ON voice_reminder_jobs(participant_id,response_at DESC)
  WHERE response IS NOT NULL;

-- Match the established automatic contact policy. This also lets the read
-- projection exclude answers belonging to a replaced destination.
CREATE FUNCTION normalize_voice_reminder_phone(raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE digits text;
BEGIN
  raw := regexp_replace(raw,'^[[:space:]]+|[[:space:]]+$','','g');
  IF raw IS NULL OR raw='' OR raw !~ '^[+]?[0-9[:space:]().-]+$' THEN RETURN NULL; END IF;
  digits := regexp_replace(raw,'[^0-9]','','g');
  IF length(digits)=9 THEN digits := '998' || digits; END IF;
  digits := regexp_replace(digits,'^00','');
  RETURN CASE WHEN digits ~ '^[1-9][0-9]{7,14}$' THEN '+' || digits ELSE NULL END;
END;
$$;
CREATE FUNCTION voice_reminder_contact_phone(student_identifier integer) RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN (SELECT COALESCE(
    (SELECT normalize_voice_reminder_phone(contact.phone) FROM academy_lead_phones contact
      WHERE contact.lead_id=lead.id AND trim(contact.phone) ~ '^[+]?[0-9[:space:]().-]+$'
        AND (length(regexp_replace(contact.phone,'[^0-9]','','g'))=9
          OR regexp_replace(regexp_replace(contact.phone,'[^0-9]','','g'),'^00','') ~ '^[1-9][0-9]{7,14}$')
      ORDER BY contact.is_primary DESC NULLS LAST,contact.id LIMIT 1),
    normalize_voice_reminder_phone(lead.phone),normalize_voice_reminder_phone(student.phone))
  FROM academy_students student LEFT JOIN academy_leads lead ON lead.id=student.lead_id
  WHERE student.id=student_identifier AND (student.lead_id IS NULL OR (lead.id IS NOT NULL AND lead.is_archived=false)));
END;
$$;
CREATE FUNCTION voice_reminder_participant_response(participant_identifier integer)
  RETURNS TABLE(response varchar,response_at timestamptz) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY SELECT job.response,job.response_at FROM voice_reminder_jobs job
  JOIN academy_demo_lesson_participants participant ON participant.id=job.participant_id
  JOIN academy_demo_lessons demo ON demo.id=participant.demo_lesson_id
  WHERE participant.id=participant_identifier AND job.response IS NOT NULL
    AND participant.demo_lesson_id=job.demo_lesson_id
    AND demo.scheduled_at AT TIME ZONE 'UTC'=job.scheduled_at
    AND demo.voice_response_revision=job.response_lesson_revision
    AND participant.voice_response_revision=job.response_participant_revision
    AND participant.status<>'cancelled' AND demo.status IN ('scheduled','completed','not_conducted')
    AND job.phone=voice_reminder_contact_phone(participant.student_id)
  ORDER BY job.response_at DESC,job.id DESC LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION validate_voice_reminder_audio_library() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration voice_reminder_settings%ROWTYPE;
DECLARE base_duration real;
DECLARE longest_hour real;
DECLARE longest_minute real;
BEGIN
  SELECT * INTO configuration FROM voice_reminder_settings WHERE id=1 FOR UPDATE;
  SELECT GREATEST(COALESCE(intro.duration_seconds,0),COALESCE(tomorrow_intro.duration_seconds,0))
    + COALESCE(outro.duration_seconds,0)
    + CASE WHEN confirmation_yes.id IS NOT NULL OR confirmation_no.id IS NOT NULL THEN 15 ELSE 0 END
    + GREATEST(COALESCE(confirmation_yes.duration_seconds,0),COALESCE(confirmation_no.duration_seconds,0))
    INTO base_duration FROM voice_reminder_settings settings
    LEFT JOIN voice_reminder_audio intro ON intro.id=settings.intro_audio_id
    LEFT JOIN voice_reminder_audio tomorrow_intro ON tomorrow_intro.id=settings.day_before_intro_audio_id
    LEFT JOIN voice_reminder_audio outro ON outro.id=settings.outro_audio_id
    LEFT JOIN voice_reminder_audio confirmation_yes ON confirmation_yes.id=settings.confirmation_yes_audio_id
    LEFT JOIN voice_reminder_audio confirmation_no ON confirmation_no.id=settings.confirmation_no_audio_id WHERE settings.id=1;
  SELECT MAX(audio.duration_seconds) INTO longest_hour FROM voice_reminder_hour_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id;
  SELECT MAX(audio.duration_seconds) INTO longest_minute FROM voice_reminder_minute_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id;
  IF base_duration>180 OR base_duration+longest_hour+longest_minute>180
    OR EXISTS (SELECT 1 FROM voice_reminder_time_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id
      WHERE base_duration+audio.duration_seconds>180) THEN
    RAISE EXCEPTION 'voiceReminderAudioTooLong' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='voice_reminder_settings' AND configuration.enabled
    AND NOT EXISTS (SELECT 1 FROM voice_reminder_time_audio)
    AND NOT (EXISTS (SELECT 1 FROM voice_reminder_hour_audio) AND EXISTS (SELECT 1 FROM voice_reminder_minute_audio)) THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE='23514';
    ELSIF NOT OLD.enabled THEN RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
