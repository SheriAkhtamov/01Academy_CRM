CREATE TABLE IF NOT EXISTS "saved_accounts" (
  "id" serial PRIMARY KEY,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label" varchar(255),
  "token_hash" varchar(128) NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_accounts_owner_idx" ON "saved_accounts" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_accounts_token_hash_unique" ON "saved_accounts" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_accounts_owner_account_unique" ON "saved_accounts" USING btree ("owner_user_id", "account_user_id");
