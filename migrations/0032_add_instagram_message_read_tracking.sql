-- Read & delivery tracking for Instagram messages.
-- Drives accurate read receipts (sent/delivered/read) and the unread separator.
-- Uses plain `timestamp` (without time zone) to match existing instagram_* columns.
ALTER TABLE "instagram_messages"
  ADD COLUMN IF NOT EXISTS "delivered_at" timestamp,
  ADD COLUMN IF NOT EXISTS "read_at" timestamp;
--> statement-breakpoint
ALTER TABLE "instagram_conversations"
  ADD COLUMN IF NOT EXISTS "last_read_message_at" timestamp;
--> statement-breakpoint
-- Speeds up "mark outbound messages up to watermark as read/delivered".
CREATE INDEX IF NOT EXISTS "instagram_messages_conversation_read_idx"
  ON "instagram_messages" ("conversation_id", "read_at");
