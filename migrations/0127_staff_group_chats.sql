CREATE TABLE IF NOT EXISTS chat_groups (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id integer NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id integer NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_group_members_user_idx ON chat_group_members(user_id);
CREATE TABLE IF NOT EXISTS chat_group_messages (
  id serial PRIMARY KEY,
  group_id integer NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_group_messages_attachments_array CHECK (jsonb_typeof(attachments) = 'array')
);
CREATE INDEX IF NOT EXISTS chat_group_messages_group_idx ON chat_group_messages(group_id, id);
