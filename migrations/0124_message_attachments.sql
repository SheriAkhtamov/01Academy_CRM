ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_attachments_array
    CHECK (jsonb_typeof(attachments) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
