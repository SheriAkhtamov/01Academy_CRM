ALTER TABLE telegram_task_reminders DROP CONSTRAINT telegram_task_reminders_kind_check;
ALTER TABLE telegram_task_reminders ADD CONSTRAINT telegram_task_reminders_kind_check
  CHECK (kind IN ('daily', 'due_soon', 'overdue', 'onlinepbx_license'));

CREATE TABLE onlinepbx_license_tasks (
  id serial PRIMARY KEY,
  domain varchar(255) NOT NULL,
  end_stamp bigint NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id integer REFERENCES board_tasks(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT onlinepbx_license_tasks_period_unique UNIQUE (domain, end_stamp, user_id)
);
