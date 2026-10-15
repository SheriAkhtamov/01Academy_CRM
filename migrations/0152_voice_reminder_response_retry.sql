-- Preserve all existing jobs and history; only new proven no-response outcomes
-- can schedule one additional follow-up. Legacy played rows are never reopened.
ALTER TABLE voice_reminder_settings ADD COLUMN response_retry_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT;
ALTER TABLE voice_reminder_jobs
  ADD COLUMN retry_phase varchar(20) NOT NULL DEFAULT 'primary' CONSTRAINT voice_reminder_jobs_retry_phase_value_check CHECK (retry_phase IN ('primary','response_retry')),
  ADD COLUMN no_response_count integer NOT NULL DEFAULT 0 CHECK (no_response_count BETWEEN 0 AND 2),
  ADD COLUMN response_retry_audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivery_lesson_revision integer,
  ADD COLUMN delivery_participant_revision integer,
  ADD COLUMN last_retry_outcome varchar(30),
  ADD CONSTRAINT voice_reminder_jobs_delivery_check CHECK ((no_response_count=0 AND delivered_at IS NULL) OR (no_response_count>0 AND delivered_at IS NOT NULL)),
  ADD CONSTRAINT voice_reminder_jobs_retry_phase_check CHECK (retry_phase<>'response_retry' OR no_response_count>0);
ALTER TABLE voice_reminder_jobs DROP CONSTRAINT voice_reminder_jobs_status_check,
  DROP CONSTRAINT voice_reminder_jobs_audio_mode_check,DROP CONSTRAINT voice_reminder_jobs_audio_parts_check;
ALTER TABLE voice_reminder_jobs
  ALTER COLUMN status TYPE varchar(30),
  ADD CONSTRAINT voice_reminder_jobs_status_check CHECK (status IN ('waiting','calling','played','delivered_no_response','unanswered','failed','cancelled')),
  ADD CONSTRAINT voice_reminder_jobs_audio_mode_check CHECK (audio_mode IN ('time','clock','standalone')),
  ADD CONSTRAINT voice_reminder_jobs_audio_parts_check CHECK (audio_mode IS NULL
    OR (audio_mode='time' AND time_audio_id IS NOT NULL AND hour_audio_id IS NULL AND minute_audio_id IS NULL AND response_retry_audio_id IS NULL)
    OR (audio_mode='clock' AND time_audio_id IS NULL AND hour_audio_id IS NOT NULL AND minute_audio_id IS NOT NULL AND response_retry_audio_id IS NULL)
    OR (audio_mode='standalone' AND retry_phase='response_retry' AND response_retry_audio_id IS NOT NULL
      AND intro_audio_id IS NULL AND outro_audio_id IS NULL AND time_audio_id IS NULL AND hour_audio_id IS NULL AND minute_audio_id IS NULL));
ALTER TABLE voice_reminder_test_calls DROP CONSTRAINT voice_reminder_test_calls_status_check;
ALTER TABLE voice_reminder_test_calls ALTER COLUMN status TYPE varchar(30),
  ADD CONSTRAINT voice_reminder_test_calls_status_check CHECK (status IN ('waiting','calling','played','delivered_no_response','unanswered','failed','cancelled'));
ALTER TABLE voice_reminder_localized_audio DROP CONSTRAINT voice_reminder_localized_audio_part_check,
  DROP CONSTRAINT voice_reminder_localized_audio_check;
ALTER TABLE voice_reminder_localized_audio
  ADD CONSTRAINT voice_reminder_localized_audio_part_check CHECK (part IN ('intro','dayBeforeIntro','outro','confirmationYes','confirmationNo','responseRetry','time','hour','minute')),
  ADD CONSTRAINT voice_reminder_localized_audio_check CHECK ((part='time' AND audio_index ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    OR (part='hour' AND audio_index ~ '^([01][0-9]|2[0-3])$') OR (part='minute' AND audio_index ~ '^[0-5][0-9]$')
    OR (part IN ('intro','dayBeforeIntro','outro','confirmationYes','confirmationNo','responseRetry') AND audio_index=''));

CREATE FUNCTION voice_reminder_job_identity_current(job_identifier bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM voice_reminder_jobs job
    JOIN academy_demo_lessons demo ON demo.id=job.demo_lesson_id
    JOIN academy_demo_lesson_participants participant ON participant.id=job.participant_id AND participant.demo_lesson_id=demo.id
    JOIN academy_students student ON student.id=participant.student_id
    LEFT JOIN academy_leads lead ON lead.id=student.lead_id
    WHERE job.id=job_identifier AND demo.status='scheduled' AND participant.status IN ('invited','confirmed')
      AND demo.scheduled_at AT TIME ZONE 'UTC'=job.scheduled_at
      AND demo.voice_reminder_revision=job.lesson_revision AND participant.voice_reminder_revision=job.participant_revision
      AND job.language=voice_reminder_contact_language(student.id) AND job.language_revision=voice_reminder_contact_language_revision(student.id)
      AND (job.phone IS NULL OR job.phone=voice_reminder_contact_phone(student.id))
      AND (student.lead_id IS NULL OR (lead.id IS NOT NULL AND lead.is_archived=false)));
$$;
CREATE FUNCTION voice_reminder_job_fresh_response(job_identifier bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM voice_reminder_jobs job
    CROSS JOIN LATERAL voice_reminder_participant_response(job.participant_id) accepted
    WHERE job.id=job_identifier AND job.delivered_at IS NOT NULL AND accepted.response_at>=job.delivered_at);
$$;
CREATE FUNCTION voice_reminder_participant_delivery(participant_identifier integer)
  RETURNS TABLE(delivery_status varchar,delivered_at timestamptz) LANGUAGE sql STABLE AS $$
  SELECT job.status,job.delivered_at FROM voice_reminder_jobs job
    JOIN academy_demo_lesson_participants participant ON participant.id=job.participant_id
    JOIN academy_demo_lessons demo ON demo.id=participant.demo_lesson_id
    WHERE participant.id=participant_identifier AND job.status='delivered_no_response' AND job.delivered_at IS NOT NULL
      AND participant.demo_lesson_id=job.demo_lesson_id AND demo.scheduled_at AT TIME ZONE 'UTC'=job.scheduled_at
      AND demo.voice_response_revision=job.delivery_lesson_revision
      AND participant.voice_response_revision=job.delivery_participant_revision
      AND participant.status<>'cancelled' AND demo.status IN ('scheduled','completed','not_conducted')
      AND job.phone=voice_reminder_contact_phone(participant.student_id)
      AND NOT EXISTS (SELECT 1 FROM voice_reminder_participant_response(participant_identifier))
    ORDER BY job.delivered_at DESC,job.id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION voice_reminder_library_audio_id(recording_language text,recording_part text,recording_index text DEFAULT '')
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
    WHEN 'responseRetry' THEN response_retry_audio_id WHEN 'outro' THEN outro_audio_id WHEN 'confirmationYes' THEN confirmation_yes_audio_id WHEN 'confirmationNo' THEN confirmation_no_audio_id END
    FROM voice_reminder_settings WHERE id=1);
END;
$$;

CREATE OR REPLACE FUNCTION validate_voice_reminder_audio_library() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configuration voice_reminder_settings%ROWTYPE;
DECLARE base_duration real;
DECLARE longest_hour real;
DECLARE longest_minute real;
DECLARE retry_duration real;
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
  SELECT retry.duration_seconds + 15 + GREATEST(COALESCE(yes_audio.duration_seconds,0),COALESCE(no_audio.duration_seconds,0)) INTO retry_duration
    FROM voice_reminder_settings settings
    JOIN voice_reminder_audio retry ON retry.id=settings.response_retry_audio_id
    LEFT JOIN voice_reminder_audio yes_audio ON yes_audio.id=settings.confirmation_yes_audio_id
    LEFT JOIN voice_reminder_audio no_audio ON no_audio.id=settings.confirmation_no_audio_id WHERE settings.id=1;
  SELECT MAX(audio.duration_seconds) INTO longest_hour FROM voice_reminder_hour_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id;
  SELECT MAX(audio.duration_seconds) INTO longest_minute FROM voice_reminder_minute_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id;
  IF retry_duration>180 OR base_duration>180 OR base_duration+longest_hour+longest_minute>180
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

CREATE OR REPLACE FUNCTION validate_localized_voice_audio() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_duration real;
DECLARE longest_hour real;
DECLARE longest_minute real;
DECLARE retry_duration real;
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
  SELECT MAX(audio.duration_seconds) FILTER(WHERE entry.part='responseRetry') + 15
    + GREATEST(COALESCE(MAX(audio.duration_seconds) FILTER(WHERE entry.part='confirmationYes'),0),
      COALESCE(MAX(audio.duration_seconds) FILTER(WHERE entry.part='confirmationNo'),0)) INTO retry_duration
    FROM voice_reminder_localized_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id WHERE entry.language='uz';
  IF retry_duration>180 OR base_duration>180 OR base_duration+longest_hour+longest_minute>180
    OR EXISTS (SELECT 1 FROM voice_reminder_localized_audio entry JOIN voice_reminder_audio audio ON audio.id=entry.audio_id
      WHERE entry.language='uz' AND entry.part='time' AND base_duration+audio.duration_seconds>180) THEN
    RAISE EXCEPTION 'voiceReminderAudioTooLong' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_changed_voice_language() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF resolve_voice_reminder_language(NEW.languages,NEW.language) IS DISTINCT FROM resolve_voice_reminder_language(OLD.languages,OLD.language) THEN
    -- Keep reservations until the call owner releases them. Taking their row
    -- locks after the job would invert the durable INVITE marker lock order.
    UPDATE voice_reminder_jobs job SET status=CASE WHEN job.no_response_count>0 THEN 'delivered_no_response' ELSE 'cancelled' END,lease_token=NULL,lease_until=NULL,
      completed_at=clock_timestamp(),updated_at=clock_timestamp()
      FROM academy_demo_lesson_participants participant,academy_students student
      WHERE participant.id=job.participant_id AND student.id=participant.student_id AND student.lead_id=NEW.id
        AND job.status IN ('waiting','calling') AND job.response IS NULL
        AND job.language_revision<>voice_reminder_contact_language_revision(student.id);
  END IF;
  RETURN NULL;
END;
$$;
