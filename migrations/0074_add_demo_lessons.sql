CREATE TABLE IF NOT EXISTS "academy_demo_lessons" (
  "id" serial PRIMARY KEY NOT NULL,
  "course_id" integer NOT NULL,
  "school_id" integer NOT NULL,
  "room_id" integer,
  "teacher_id" integer NOT NULL,
  "scheduled_at" timestamp NOT NULL,
  "duration_minutes" integer DEFAULT 60 NOT NULL,
  "format" varchar(20) DEFAULT 'offline' NOT NULL,
  "capacity" integer DEFAULT 1 NOT NULL,
  "status" varchar(30) DEFAULT 'scheduled' NOT NULL,
  "notes" text,
  "cancellation_reason" text,
  "created_by" integer,
  "updated_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "academy_demo_lessons_duration_check" CHECK ("duration_minutes" BETWEEN 15 AND 480),
  CONSTRAINT "academy_demo_lessons_capacity_check" CHECK ("capacity" BETWEEN 1 AND 100),
  CONSTRAINT "academy_demo_lessons_format_check" CHECK ("format" IN ('offline', 'online')),
  CONSTRAINT "academy_demo_lessons_status_check" CHECK ("status" IN ('scheduled', 'completed', 'cancelled')),
  CONSTRAINT "academy_demo_lessons_room_format_check" CHECK (
    ("format" = 'offline' AND "room_id" IS NOT NULL)
    OR ("format" = 'online' AND "room_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_demo_lesson_participants" (
  "id" serial PRIMARY KEY NOT NULL,
  "demo_lesson_id" integer NOT NULL,
  "lead_id" integer NOT NULL,
  "status" varchar(30) DEFAULT 'invited' NOT NULL,
  "result" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "academy_demo_lesson_participants_status_check" CHECK (
    "status" IN ('invited', 'confirmed', 'attended', 'no_show', 'cancelled')
  )
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lessons" ADD CONSTRAINT "academy_demo_lessons_course_id_academy_courses_id_fk"
 FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lessons" ADD CONSTRAINT "academy_demo_lessons_school_id_academy_schools_id_fk"
 FOREIGN KEY ("school_id") REFERENCES "public"."academy_schools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lessons" ADD CONSTRAINT "academy_demo_lessons_room_id_academy_rooms_id_fk"
 FOREIGN KEY ("room_id") REFERENCES "public"."academy_rooms"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lessons" ADD CONSTRAINT "academy_demo_lessons_teacher_id_academy_teachers_id_fk"
 FOREIGN KEY ("teacher_id") REFERENCES "public"."academy_teachers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lessons" ADD CONSTRAINT "academy_demo_lessons_created_by_users_id_fk"
 FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lessons" ADD CONSTRAINT "academy_demo_lessons_updated_by_users_id_fk"
 FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lesson_participants" ADD CONSTRAINT "academy_demo_lesson_participants_demo_lesson_id_fk"
 FOREIGN KEY ("demo_lesson_id") REFERENCES "public"."academy_demo_lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_demo_lesson_participants" ADD CONSTRAINT "academy_demo_lesson_participants_lead_id_fk"
 FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_demo_lessons_schedule_idx"
  ON "academy_demo_lessons" USING btree ("scheduled_at", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_demo_lessons_room_idx"
  ON "academy_demo_lessons" USING btree ("room_id", "scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_demo_lessons_teacher_idx"
  ON "academy_demo_lessons" USING btree ("teacher_id", "scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_demo_lessons_school_idx"
  ON "academy_demo_lessons" USING btree ("school_id", "scheduled_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_demo_lesson_participants_unique"
  ON "academy_demo_lesson_participants" USING btree ("demo_lesson_id", "lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_demo_lesson_participants_lead_idx"
  ON "academy_demo_lesson_participants" USING btree ("lead_id", "demo_lesson_id");
