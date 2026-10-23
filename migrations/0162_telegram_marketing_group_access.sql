ALTER TABLE telegram_marketing_sessions
  DROP CONSTRAINT telegram_marketing_session_ids;
--> statement-breakpoint
ALTER TABLE telegram_marketing_sessions
  ADD CONSTRAINT telegram_marketing_session_ids
  CHECK (bot_id ~ '^[0-9]+$' AND telegram_user_id ~ '^-?[1-9][0-9]*$');
