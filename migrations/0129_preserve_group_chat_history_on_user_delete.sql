ALTER TABLE chat_groups ADD COLUMN IF NOT EXISTS creator_name varchar(255) NOT NULL DEFAULT '';
ALTER TABLE chat_group_messages ADD COLUMN IF NOT EXISTS sender_name varchar(255) NOT NULL DEFAULT '';

UPDATE chat_groups g SET creator_name = u.full_name FROM users u WHERE g.created_by = u.id AND g.creator_name = '';
UPDATE chat_group_messages m SET sender_name = u.full_name FROM users u WHERE m.sender_id = u.id AND m.sender_name = '';

ALTER TABLE chat_groups ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE chat_group_messages ALTER COLUMN sender_id DROP NOT NULL;

-- Support both native PostgreSQL and Drizzle-generated constraint names.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname, c.conrelid::regclass AS table_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
      AND ((c.conrelid = 'chat_groups'::regclass AND a.attname = 'created_by')
        OR (c.conrelid = 'chat_group_messages'::regclass AND a.attname = 'sender_id'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', constraint_row.table_name, constraint_row.conname);
  END LOOP;
END $$;

ALTER TABLE chat_groups ADD CONSTRAINT chat_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_group_messages ADD CONSTRAINT chat_group_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;
