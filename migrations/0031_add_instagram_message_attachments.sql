ALTER TABLE "instagram_messages"
  ADD COLUMN IF NOT EXISTS "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instagram_messages_attachments_idx"
  ON "instagram_messages" USING gin ("attachments");
