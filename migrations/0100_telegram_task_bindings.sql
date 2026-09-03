CREATE TABLE telegram_task_bindings (
  id serial PRIMARY KEY,
  bot_id varchar(32) NOT NULL,
  telegram_user_id varchar(32) NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_phone varchar(32) NOT NULL,
  verification_id varchar(36) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT telegram_task_bindings_telegram_unique UNIQUE (bot_id, telegram_user_id),
  CONSTRAINT telegram_task_bindings_employee_unique UNIQUE (bot_id, user_id)
);
