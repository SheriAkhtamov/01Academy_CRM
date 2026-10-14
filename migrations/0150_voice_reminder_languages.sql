-- Existing Russian links and historical attempts stay in their original tables.
CREATE TABLE voice_reminder_localized_audio (
  language varchar(2) NOT NULL CHECK (language='uz'),
  part varchar(24) NOT NULL CHECK (part IN ('intro','dayBeforeIntro','outro','confirmationYes','confirmationNo','time','hour','minute')),
  audio_index varchar(5) NOT NULL DEFAULT '',
  audio_id uuid NOT NULL REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(language,part,audio_index),
  CHECK ((part='time' AND audio_index ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    OR (part='hour' AND audio_index ~ '^([01][0-9]|2[0-3])$')
    OR (part='minute' AND audio_index ~ '^[0-5][0-9]$')
    OR (part IN ('intro','dayBeforeIntro','outro','confirmationYes','confirmationNo') AND audio_index=''))
);
CREATE TABLE voice_reminder_lead_language_epochs (
  lead_id integer PRIMARY KEY REFERENCES academy_leads(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision>=0)
);
ALTER TABLE voice_reminder_jobs
  ADD COLUMN language varchar(2) NOT NULL DEFAULT 'ru' CHECK (language IN ('ru','uz')),
  ADD COLUMN language_revision integer NOT NULL DEFAULT 0 CHECK (language_revision>=0);
ALTER TABLE voice_reminder_test_calls ADD COLUMN language varchar(2) NOT NULL DEFAULT 'ru' CHECK (language IN ('ru','uz'));
DROP INDEX voice_reminder_jobs_demo_participant_schedule_unique;
CREATE UNIQUE INDEX voice_reminder_jobs_demo_participant_schedule_unique ON voice_reminder_jobs
  (demo_lesson_id,participant_id,scheduled_at,lesson_revision,participant_revision,reminder_kind,language,language_revision);

-- Match selectedLeadLanguages: an actual array is authoritative, including an
-- empty array. Legacy language is used only when the array is NULL. Preserve
-- the first supported selection (English uses the Russian recording).
CREATE FUNCTION resolve_voice_reminder_language(languages text[],legacy_language text) RETURNS varchar
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN (CASE WHEN languages IS NULL THEN
    CASE WHEN legacy_language IN ('ru','uz','en') THEN legacy_language ELSE NULL END
    ELSE (SELECT selected.value FROM unnest(languages) WITH ORDINALITY selected(value,position)
      WHERE selected.value IN ('ru','uz','en') ORDER BY selected.position LIMIT 1) END)='uz' THEN 'uz' ELSE 'ru' END::varchar;
$$;
CREATE FUNCTION voice_reminder_contact_language(student_identifier integer) RETURNS varchar LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT resolve_voice_reminder_language(lead.languages,lead.language)
    FROM academy_students student LEFT JOIN academy_leads lead ON lead.id=student.lead_id
    WHERE student.id=student_identifier),'ru')::varchar;
$$;
CREATE FUNCTION voice_reminder_contact_language_revision(student_identifier integer) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT epoch.revision FROM academy_students student
    LEFT JOIN voice_reminder_lead_language_epochs epoch ON epoch.lead_id=student.lead_id WHERE student.id=student_identifier),0);
$$;
CREATE FUNCTION revise_lead_voice_language() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF resolve_voice_reminder_language(NEW.languages,NEW.language) IS DISTINCT FROM resolve_voice_reminder_language(OLD.languages,OLD.language) THEN
    INSERT INTO voice_reminder_lead_language_epochs(lead_id,revision) VALUES(NEW.id,1)
      ON CONFLICT(lead_id) DO UPDATE SET revision=voice_reminder_lead_language_epochs.revision+1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER revise_lead_voice_language BEFORE UPDATE OF languages,language ON academy_leads
  FOR EACH ROW EXECUTE FUNCTION revise_lead_voice_language();
CREATE FUNCTION cancel_changed_voice_language() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF resolve_voice_reminder_language(NEW.languages,NEW.language) IS DISTINCT FROM resolve_voice_reminder_language(OLD.languages,OLD.language) THEN
    -- Keep reservations until the call owner releases them. Taking their row
    -- locks after the job would invert the durable INVITE marker lock order.
    UPDATE voice_reminder_jobs job SET status='cancelled',lease_token=NULL,lease_until=NULL,
      completed_at=clock_timestamp(),updated_at=clock_timestamp()
      FROM academy_demo_lesson_participants participant,academy_students student
      WHERE participant.id=job.participant_id AND student.id=participant.student_id AND student.lead_id=NEW.id
        AND job.status IN ('waiting','calling') AND job.response IS NULL
        AND job.language_revision<>voice_reminder_contact_language_revision(student.id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER cancel_changed_voice_language AFTER UPDATE OF languages,language ON academy_leads
  FOR EACH ROW EXECUTE FUNCTION cancel_changed_voice_language();

-- A language-specific lookup is shared by admission and the final receipt
-- fence. There is deliberately no Russian fallback for an incomplete UZ set.
CREATE FUNCTION voice_reminder_library_audio_id(recording_language text,recording_part text,recording_index text DEFAULT '')
  RETURNS uuid LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF recording_language='uz' THEN
    RETURN (SELECT audio_id FROM voice_reminder_localized_audio WHERE language='uz' AND part=recording_part AND audio_index=recording_index);
  ELSIF recording_language IS DISTINCT FROM 'ru' THEN RETURN NULL;
  END IF;
  IF recording_part='time' THEN RETURN (SELECT audio_id FROM voice_reminder_time_audio WHERE time=recording_index);
  ELSIF recording_part='hour' THEN RETURN (SELECT audio_id FROM voice_reminder_hour_audio WHERE hour=recording_index);
  ELSIF recording_part='minute' THEN RETURN (SELECT audio_id FROM voice_reminder_minute_audio WHERE minute=recording_index);
  END IF;
  RETURN (SELECT CASE recording_part WHEN 'intro' THEN intro_audio_id WHEN 'dayBeforeIntro' THEN day_before_intro_audio_id
    WHEN 'outro' THEN outro_audio_id WHEN 'confirmationYes' THEN confirmation_yes_audio_id WHEN 'confirmationNo' THEN confirmation_no_audio_id END
    FROM voice_reminder_settings WHERE id=1);
END;
$$;
CREATE FUNCTION voice_reminder_library_ready(recording_language text,clock_time text,reminder_kind text,confirmation boolean)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT voice_reminder_library_audio_id(recording_language,CASE WHEN reminder_kind='day_before' THEN 'dayBeforeIntro' ELSE 'intro' END) IS NOT NULL
    AND voice_reminder_library_audio_id(recording_language,'outro') IS NOT NULL
    AND (NOT confirmation OR (voice_reminder_library_audio_id(recording_language,'confirmationYes') IS NOT NULL
      AND voice_reminder_library_audio_id(recording_language,'confirmationNo') IS NOT NULL))
    AND (voice_reminder_library_audio_id(recording_language,'time',clock_time) IS NOT NULL
      OR (voice_reminder_library_audio_id(recording_language,'hour',substring(clock_time,1,2)) IS NOT NULL
        AND voice_reminder_library_audio_id(recording_language,'minute',substring(clock_time,4,2)) IS NOT NULL));
$$;
CREATE FUNCTION validate_localized_voice_audio() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_duration real;
DECLARE longest_hour real;
DECLARE longest_minute real;
BEGIN
  PERFORM id FROM voice_reminder_settings WHERE id=1 FOR UPDATE;
  SELECT GREATEST(COALESCE(MAX(audio.duration_seconds) FILTER(WHERE entry.part='intro'),0),
      COALESCE(MAX(audio.duration_seconds) FILTER(WHERE entry.part='dayBeforeIntro'),0))
    + COALESCE(MAX(audio.duration_seconds) FILTER(WHERE entry.part='outro'),0)
    + GREATEST(COALESCE(MAX(audio.duration_seconds) FILTER(WHERE entry.part='confirmationYes'),0),
      COALESCE(MAX(audio.duration_seconds) FILTER(WHERE entry.part='confirmationNo'),0))
    + CASE WHEN COUNT(*) FILTER(WHERE entry.part IN ('confirmationYes','confirmationNo'))>0 THEN 15 ELSE 0 END,
    MAX(audio.duration_seconds) FILTER(WHERE entry.part='hour'),MAX(audio.duration_seconds) FILTER(WHERE entry.part='minute')
    INTO base_duration,longest_hour,longest_minute
    FROM voice_reminder_localized_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id WHERE entry.language='uz';
  IF base_duration>180 OR base_duration+longest_hour+longest_minute>180
    OR EXISTS (SELECT 1 FROM voice_reminder_localized_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id
      WHERE entry.language='uz' AND entry.part='time' AND base_duration+audio.duration_seconds>180) THEN
    RAISE EXCEPTION 'voiceReminderAudioTooLong' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION lock_localized_voice_library() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM voice_reminder_settings WHERE id=1 FOR UPDATE;
  RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE TRIGGER lock_localized_voice_library BEFORE INSERT OR UPDATE OR DELETE ON voice_reminder_localized_audio
  FOR EACH ROW EXECUTE FUNCTION lock_localized_voice_library();
CREATE TRIGGER validate_localized_voice_audio AFTER INSERT OR UPDATE OR DELETE ON voice_reminder_localized_audio
  FOR EACH ROW EXECUTE FUNCTION validate_localized_voice_audio();

CREATE OR REPLACE FUNCTION voice_reminder_participant_response(participant_identifier integer)
  RETURNS TABLE(response varchar,response_at timestamptz) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY SELECT job.response,job.response_at FROM voice_reminder_jobs job
  JOIN academy_demo_lesson_participants participant ON participant.id=job.participant_id
  JOIN academy_demo_lessons demo ON demo.id=participant.demo_lesson_id
  WHERE participant.id=participant_identifier AND job.response IS NOT NULL
    AND participant.demo_lesson_id=job.demo_lesson_id AND demo.scheduled_at AT TIME ZONE 'UTC'=job.scheduled_at
    AND demo.voice_response_revision=job.response_lesson_revision
    AND participant.voice_response_revision=job.response_participant_revision
    AND participant.status<>'cancelled' AND demo.status IN ('scheduled','completed','not_conducted')
    AND job.phone=voice_reminder_contact_phone(participant.student_id)
  ORDER BY job.response_at DESC,job.id DESC LIMIT 1;
END;
$$;

-- Global controls admit either complete language, never a mix of languages.
ALTER TABLE voice_reminder_settings DROP CONSTRAINT voice_reminder_settings_modular_audio_check,
  DROP CONSTRAINT voice_reminder_settings_day_before_audio_check,
  DROP CONSTRAINT voice_reminder_settings_confirmation_audio_check;
CREATE FUNCTION voice_reminder_language_complete(recording_language text,day_before boolean,confirmation boolean)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT voice_reminder_library_audio_id(recording_language,'intro') IS NOT NULL
    AND voice_reminder_library_audio_id(recording_language,'outro') IS NOT NULL
    AND (NOT day_before OR voice_reminder_library_audio_id(recording_language,'dayBeforeIntro') IS NOT NULL)
    AND (NOT confirmation OR (voice_reminder_library_audio_id(recording_language,'confirmationYes') IS NOT NULL
      AND voice_reminder_library_audio_id(recording_language,'confirmationNo') IS NOT NULL))
    AND CASE WHEN recording_language='ru' THEN EXISTS(SELECT 1 FROM voice_reminder_time_audio)
      OR (EXISTS(SELECT 1 FROM voice_reminder_hour_audio) AND EXISTS(SELECT 1 FROM voice_reminder_minute_audio))
      ELSE EXISTS(SELECT 1 FROM voice_reminder_localized_audio WHERE language='uz' AND part='time')
      OR (EXISTS(SELECT 1 FROM voice_reminder_localized_audio WHERE language='uz' AND part='hour')
        AND EXISTS(SELECT 1 FROM voice_reminder_localized_audio WHERE language='uz' AND part='minute')) END;
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
  IF configuration.confirmation_enabled AND NOT (
    (configuration.confirmation_yes_audio_id IS NOT NULL AND configuration.confirmation_no_audio_id IS NOT NULL)
    OR (voice_reminder_library_audio_id('uz','confirmationYes') IS NOT NULL AND voice_reminder_library_audio_id('uz','confirmationNo') IS NOT NULL)) THEN
    RAISE EXCEPTION 'voiceReminderConfirmationAudioRequired' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='voice_reminder_settings' AND configuration.enabled
    AND NOT (voice_reminder_language_complete('ru',configuration.day_before_enabled,configuration.confirmation_enabled)
      OR voice_reminder_language_complete('uz',configuration.day_before_enabled,configuration.confirmation_enabled)) THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE='23514';
    ELSIF NOT OLD.enabled THEN RAISE EXCEPTION 'voiceReminderAudioRequired' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
