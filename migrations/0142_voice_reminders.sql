CREATE TABLE IF NOT EXISTS voice_reminder_audio (
  id uuid PRIMARY KEY,
  file_name varchar(180) NOT NULL,
  mime_type varchar(30) NOT NULL CHECK (mime_type IN ('audio/mpeg', 'audio/wav')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  duration_seconds real NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 180),
  storage_key varchar(80) NOT NULL UNIQUE,
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by integer REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_reminder_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  lead_minutes integer NOT NULL DEFAULT 60 CHECK (lead_minutes BETWEEN 1 AND 1440),
  max_attempts integer NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 5),
  retry_minutes integer NOT NULL DEFAULT 10 CHECK (retry_minutes BETWEEN 1 AND 60),
  allowed_start_time varchar(5) NOT NULL DEFAULT '09:00' CHECK (allowed_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  allowed_end_time varchar(5) NOT NULL DEFAULT '20:00' CHECK (allowed_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  max_concurrent_calls integer NOT NULL DEFAULT 2 CHECK (max_concurrent_calls BETWEEN 1 AND 2),
  audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (allowed_start_time < allowed_end_time),
  CHECK (NOT enabled OR audio_id IS NOT NULL)
);
INSERT INTO voice_reminder_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE academy_demo_lessons ADD COLUMN IF NOT EXISTS voice_reminder_revision integer NOT NULL DEFAULT 0 CHECK (voice_reminder_revision >= 0);
ALTER TABLE academy_demo_lesson_participants ADD COLUMN IF NOT EXISTS voice_reminder_revision integer NOT NULL DEFAULT 0 CHECK (voice_reminder_revision >= 0);

CREATE TABLE IF NOT EXISTS voice_reminder_jobs (
  id bigserial PRIMARY KEY,
  demo_lesson_id integer NOT NULL REFERENCES academy_demo_lessons(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES academy_demo_lesson_participants(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  lesson_revision integer NOT NULL DEFAULT 0 CHECK (lesson_revision >= 0),
  participant_revision integer NOT NULL DEFAULT 0 CHECK (participant_revision >= 0),
  due_at timestamptz NOT NULL,
  not_before_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'calling', 'played', 'unanswered', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  phone varchar(20),
  audio_id uuid REFERENCES voice_reminder_audio(id) ON DELETE RESTRICT,
  lease_token uuid,
  lease_until timestamptz,
  last_call_at timestamptz,
  completed_at timestamptz,
  provider_call_id varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (demo_lesson_id, participant_id, scheduled_at, lesson_revision, participant_revision),
  CHECK ((status = 'calling' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
      OR (status <> 'calling' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS voice_reminder_jobs_due_idx ON voice_reminder_jobs (status, due_at);
CREATE INDEX IF NOT EXISTS voice_reminder_jobs_lease_idx ON voice_reminder_jobs (lease_until) WHERE status = 'calling';

CREATE TABLE IF NOT EXISTS telephony_line_reservations (
  id uuid PRIMARY KEY,
  extension varchar(20) NOT NULL UNIQUE,
  owner_type varchar(20) NOT NULL CHECK (owner_type IN ('manager', 'robot')),
  owner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  client_call_id varchar(160) NOT NULL,
  phone varchar(20),
  job_id bigint REFERENCES voice_reminder_jobs(id) ON DELETE SET NULL,
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telephony_line_reservations_lease_idx ON telephony_line_reservations (lease_until);

-- These immutable attempt identities outlive channel leases so a delayed PBX
-- callback cannot be attributed to the employee who shares the extension.
CREATE TABLE IF NOT EXISTS voice_reminder_call_attempts (
  call_id uuid PRIMARY KEY,
  job_id bigint REFERENCES voice_reminder_jobs(id) ON DELETE SET NULL,
  extension varchar(20) NOT NULL,
  phone varchar(20) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  provider_id varchar(160) UNIQUE,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS voice_reminder_call_attempts_match_idx ON voice_reminder_call_attempts (phone, extension, started_at);

-- An ambiguous robot callback is kept outside employee journals without
-- inventing an association with one of the candidate attempts.
CREATE TABLE IF NOT EXISTS voice_reminder_provider_quarantine (
  provider_id varchar(160) PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cancellation participates in the same transaction as a lesson change. A live
-- transport observes the removed lease on its next pre-dial/playback guard.
CREATE OR REPLACE FUNCTION cancel_changed_demo_voice_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
    OR (NEW.status = 'scheduled') IS DISTINCT FROM (OLD.status = 'scheduled') THEN
    NEW.voice_reminder_revision := OLD.voice_reminder_revision + 1;
    UPDATE voice_reminder_jobs SET status = 'cancelled', lease_token = NULL, lease_until = NULL,
      completed_at = now(), updated_at = now()
    WHERE demo_lesson_id = OLD.id AND status IN ('waiting', 'calling');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cancel_changed_demo_voice_reminders ON academy_demo_lessons;
CREATE TRIGGER cancel_changed_demo_voice_reminders BEFORE UPDATE OF scheduled_at, status ON academy_demo_lessons
  FOR EACH ROW EXECUTE FUNCTION cancel_changed_demo_voice_reminders();

CREATE OR REPLACE FUNCTION cancel_changed_participant_voice_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IN ('invited', 'confirmed')) IS DISTINCT FROM (OLD.status IN ('invited', 'confirmed'))
    OR NEW.student_id IS DISTINCT FROM OLD.student_id
    OR NEW.demo_lesson_id IS DISTINCT FROM OLD.demo_lesson_id THEN
    NEW.voice_reminder_revision := OLD.voice_reminder_revision + 1;
    UPDATE voice_reminder_jobs SET status = 'cancelled', lease_token = NULL, lease_until = NULL,
      completed_at = now(), updated_at = now()
    WHERE participant_id = OLD.id AND status IN ('waiting', 'calling');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cancel_changed_participant_voice_reminders ON academy_demo_lesson_participants;
CREATE TRIGGER cancel_changed_participant_voice_reminders BEFORE UPDATE OF status, student_id, demo_lesson_id
  ON academy_demo_lesson_participants FOR EACH ROW EXECUTE FUNCTION cancel_changed_participant_voice_reminders();
