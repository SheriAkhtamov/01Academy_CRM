CREATE TABLE voice_reminder_call_details (
  call_id uuid PRIMARY KEY REFERENCES voice_reminder_call_attempts(call_id) ON DELETE CASCADE,
  lead_id integer REFERENCES academy_leads(id) ON DELETE SET NULL,
  student_id integer NOT NULL,
  participant_id integer NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'dialing' CHECK (status IN ('dialing','connected','ended','failed')),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds>=0),
  talk_seconds integer NOT NULL DEFAULT 0 CHECK (talk_seconds>=0),
  hangup_cause varchar(120),
  reminder_outcome varchar(30),
  reminder_response varchar(3) CHECK (reminder_response IN ('yes','no')),
  recording_url text,
  recording_provider_id varchar(160),
  recording_checked_at timestamptz,
  recording_attempts integer NOT NULL DEFAULT 0 CHECK (recording_attempts>=0),
  recording_storage_key varchar(100),
  recording_mime_type varchar(80),
  recording_size_bytes integer,
  recording_sha256 varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voice_reminder_call_details_lead_idx ON voice_reminder_call_details(lead_id,call_id);
CREATE INDEX voice_reminder_call_details_pending_recording_idx ON voice_reminder_call_details(recording_checked_at,call_id)
  WHERE recording_storage_key IS NULL AND ended_at IS NOT NULL;

-- Older receipts did not freeze their student/lead. Only recover associations
-- whose prepared identity can still be proven; never match a lead by phone.
INSERT INTO voice_reminder_call_details
  (call_id,lead_id,student_id,participant_id,status,ended_at,duration_seconds,reminder_outcome,reminder_response)
SELECT attempt.call_id,student.lead_id,student.id,participant.id,
  CASE WHEN attempt.completed_at IS NULL AND attempt.termination_confirmed_at IS NULL THEN 'dialing'
    WHEN job.provider_call_id IN (attempt.call_id::text,attempt.provider_id) AND job.status IN ('failed','unanswered') THEN 'failed'
    ELSE 'ended' END,
  COALESCE(attempt.termination_confirmed_at,attempt.completed_at),
  GREATEST(0,FLOOR(EXTRACT(EPOCH FROM COALESCE(attempt.termination_confirmed_at,attempt.completed_at)-attempt.started_at)))::integer,
  CASE WHEN job.response_call_id=attempt.call_id::text THEN 'played'
    WHEN job.provider_call_id IN (attempt.call_id::text,attempt.provider_id)
      AND job.retry_phase='response_retry' AND job.last_retry_outcome IN ('played','delivered_no_response','unanswered','failed','cancelled')
      THEN job.last_retry_outcome
    WHEN job.provider_call_id IN (attempt.call_id::text,attempt.provider_id)
      AND job.status IN ('unanswered','failed','cancelled') THEN job.status END,
  CASE WHEN job.response_call_id=attempt.call_id::text THEN job.response END
FROM voice_reminder_call_attempts attempt
JOIN voice_reminder_jobs job ON job.id=attempt.job_id
JOIN academy_demo_lesson_participants participant ON participant.id=job.participant_id AND participant.demo_lesson_id=job.demo_lesson_id
JOIN academy_demo_lessons demo ON demo.id=participant.demo_lesson_id
JOIN academy_students student ON student.id=participant.student_id
LEFT JOIN academy_leads lead ON lead.id=student.lead_id
WHERE student.lead_id IS NOT NULL AND lead.id IS NOT NULL
  AND job.scheduled_at=demo.scheduled_at AT TIME ZONE 'UTC'
  AND attempt.phone=job.phone AND job.phone=voice_reminder_contact_phone(student.id)
  AND ((job.delivery_lesson_revision=demo.voice_response_revision
      AND job.delivery_participant_revision=participant.voice_response_revision)
    OR (job.delivery_lesson_revision IS NULL AND job.delivery_participant_revision IS NULL
      AND job.lesson_revision=demo.voice_reminder_revision AND job.participant_revision=participant.voice_reminder_revision
      AND job.language=voice_reminder_contact_language(student.id)
      AND job.language_revision=voice_reminder_contact_language_revision(student.id)))
ON CONFLICT(call_id) DO NOTHING;
