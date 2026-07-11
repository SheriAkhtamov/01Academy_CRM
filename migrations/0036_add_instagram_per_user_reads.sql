CREATE TABLE IF NOT EXISTS "instagram_conversation_reads" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "last_read_message_id" integer DEFAULT 0 NOT NULL,
  "last_read_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "instagram_conversation_reads_conversation_id_instagram_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."instagram_conversations"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "instagram_conversation_reads_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_conversation_reads_conversation_user_unique"
  ON "instagram_conversation_reads" USING btree ("conversation_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instagram_conversation_reads_user_idx"
  ON "instagram_conversation_reads" USING btree ("user_id");
