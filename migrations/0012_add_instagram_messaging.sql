CREATE TABLE "instagram_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ig_user_id" varchar(80) NOT NULL,
	"username" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"profile_picture_url" text,
	"access_token_encrypted" text,
	"token_expires_at" timestamp,
	"source_id" integer NOT NULL,
	"status" varchar(40) DEFAULT 'connected' NOT NULL,
	"last_webhook_at" timestamp,
	"last_error" text,
	"connected_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "instagram_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"lead_id" integer,
	"participant_igsid" varchar(80) NOT NULL,
	"participant_username" varchar(255),
	"participant_name" varchar(255),
	"participant_profile_picture_url" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"last_inbound_at" timestamp,
	"last_outbound_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "instagram_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"external_message_id" varchar(255),
	"direction" varchar(20) NOT NULL,
	"sender_igsid" varchar(80) NOT NULL,
	"recipient_igsid" varchar(80) NOT NULL,
	"content" text NOT NULL,
	"message_type" varchar(50) DEFAULT 'text' NOT NULL,
	"status" varchar(40) DEFAULT 'received' NOT NULL,
	"sent_by" integer,
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_source_id_academy_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."academy_lead_sources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instagram_conversations" ADD CONSTRAINT "instagram_conversations_account_id_instagram_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instagram_conversations" ADD CONSTRAINT "instagram_conversations_lead_id_academy_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instagram_messages" ADD CONSTRAINT "instagram_messages_conversation_id_instagram_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."instagram_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instagram_messages" ADD CONSTRAINT "instagram_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_accounts_ig_user_unique" ON "instagram_accounts" USING btree ("ig_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_accounts_source_unique" ON "instagram_accounts" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX "instagram_accounts_status_idx" ON "instagram_accounts" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_conversations_account_participant_unique" ON "instagram_conversations" USING btree ("account_id","participant_igsid");
--> statement-breakpoint
CREATE INDEX "instagram_conversations_account_idx" ON "instagram_conversations" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX "instagram_conversations_lead_idx" ON "instagram_conversations" USING btree ("lead_id");
--> statement-breakpoint
CREATE INDEX "instagram_conversations_last_message_idx" ON "instagram_conversations" USING btree ("last_message_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_messages_external_message_unique" ON "instagram_messages" USING btree ("external_message_id");
--> statement-breakpoint
CREATE INDEX "instagram_messages_conversation_idx" ON "instagram_messages" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX "instagram_messages_created_idx" ON "instagram_messages" USING btree ("created_at");
