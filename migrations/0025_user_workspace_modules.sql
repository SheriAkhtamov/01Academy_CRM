CREATE TABLE IF NOT EXISTS "user_workspaces" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "workspace" varchar(50) NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "user_workspaces_user_workspace_unique" UNIQUE("user_id", "workspace"),
  CONSTRAINT "user_workspaces_workspace_check" CHECK ("user_workspaces"."workspace" IN ('administration', 'director', 'sales', 'teacher', 'marketing'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_workspaces_user_idx" ON "user_workspaces" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_workspaces_workspace_idx" ON "user_workspaces" USING btree ("workspace");
--> statement-breakpoint
INSERT INTO "user_workspaces" ("user_id", "workspace")
SELECT "id", "workspace"
FROM "users"
ON CONFLICT ("user_id", "workspace") DO NOTHING;
