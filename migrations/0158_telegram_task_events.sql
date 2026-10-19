CREATE TABLE telegram_task_events (
  id serial PRIMARY KEY,
  recipient_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key varchar(120) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  next_attempt_at timestamp,
  created_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT telegram_task_events_status_check CHECK (status IN ('pending', 'attempted', 'sent', 'deferred', 'failed', 'uncertain', 'skipped'))
);
CREATE UNIQUE INDEX telegram_task_events_event_unique ON telegram_task_events (recipient_id, event_key);
CREATE INDEX telegram_task_events_pending_idx ON telegram_task_events (status, next_attempt_at, id);
ALTER TABLE telegram_task_reminders DROP CONSTRAINT telegram_task_reminders_kind_check;
ALTER TABLE telegram_task_reminders ADD CONSTRAINT telegram_task_reminders_kind_check CHECK (kind IN ('daily', 'due_soon', 'overdue'));
