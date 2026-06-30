-- Recovery migration for the administration task board.
-- The original board DDL lived in an orphaned 0008_* file that was not listed
-- in Drizzle's migration journal, so existing deployments skipped it.
CREATE TABLE IF NOT EXISTS "boards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"board_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'backlog' NOT NULL,
	"priority" varchar(10) DEFAULT 'normal' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"creator_id" integer,
	"assignee_id" integer,
	"due_at" timestamp,
	"accepted_at" timestamp,
	"accepted_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "board_tasks_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "board_tasks_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "board_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "board_tasks_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "board_tasks_status_check" CHECK ("board_tasks"."status" IN ('backlog', 'todo', 'in_progress', 'done', 'accepted')),
	CONSTRAINT "board_tasks_priority_check" CHECK ("board_tasks"."priority" IN ('urgent', 'normal', 'low'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"author_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "board_task_comments_task_id_board_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."board_tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "board_task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_task_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"content" varchar(500) NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "board_task_checklist_items_task_id_board_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."board_tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "board_task_checklist_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_task_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(120),
	"size" integer DEFAULT 0 NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "board_task_attachments_task_id_board_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."board_tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "board_task_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_task_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"actor_id" integer,
	"type" varchar(40) NOT NULL,
	"from_value" varchar(120),
	"to_value" varchar(120),
	"meta" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "board_task_activity_task_id_board_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."board_tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "board_task_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boards_default_idx" ON "boards" USING btree ("is_default");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_tasks_board_status_idx" ON "board_tasks" USING btree ("board_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_tasks_assignee_idx" ON "board_tasks" USING btree ("assignee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_tasks_creator_idx" ON "board_tasks" USING btree ("creator_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_task_comments_task_idx" ON "board_task_comments" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_task_checklist_items_task_idx" ON "board_task_checklist_items" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_task_attachments_task_idx" ON "board_task_attachments" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_task_activity_task_idx" ON "board_task_activity" USING btree ("task_id");
--> statement-breakpoint
INSERT INTO "boards" ("name", "description", "is_default")
SELECT 'Менеджмент', 'Общая доска задач команды', true
WHERE NOT EXISTS (
	SELECT 1 FROM "boards" WHERE "is_default" = true AND "is_archived" = false
);
