-- No task text or credentials are stored in delivery history.
CREATE TABLE IF NOT EXISTS telegram_task_reminders (
  id serial PRIMARY KEY,
  binding_id integer NOT NULL REFERENCES telegram_task_bindings(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('daily', 'due_soon')),
  event_key varchar(120) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('attempted', 'sent', 'deferred', 'failed', 'uncertain')),
  next_attempt_at timestamp,
  error_code integer,
  created_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  updated_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT telegram_task_reminders_event_unique UNIQUE (binding_id, kind, event_key)
);
CREATE INDEX IF NOT EXISTS telegram_task_reminders_cooldown_idx
  ON telegram_task_reminders (error_code, next_attempt_at);
