CREATE TABLE telegram_marketing_sessions (
  bot_id text NOT NULL,
  telegram_user_id text NOT NULL,
  access_version text,
  authenticated_at timestamp,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamp,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp NOT NULL DEFAULT timezone('UTC', now()),
  PRIMARY KEY (bot_id, telegram_user_id),
  CONSTRAINT telegram_marketing_session_ids CHECK (bot_id ~ '^[0-9]+$' AND telegram_user_id ~ '^[1-9][0-9]*$'),
  CONSTRAINT telegram_marketing_failures CHECK (failures >= 0)
);
