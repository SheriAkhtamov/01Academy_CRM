CREATE TABLE "academy_schools" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "code" varchar(100) NOT NULL,
  "address" text NOT NULL,
  "rooms" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "timezone" varchar(80) DEFAULT 'Asia/Tashkent' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_schools_code_unique" ON "academy_schools" USING btree ("code");
--> statement-breakpoint
ALTER TABLE "academy_courses" ADD COLUMN "duration_days" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "academy_courses"
SET "duration_days" = CASE
  WHEN COALESCE("frequency", '') ~* '(3|три).*(раз|times)' THEN CEIL("lesson_count" / 3.0)::integer * 7
  WHEN COALESCE("frequency", '') ~* '(2|два).*(раз|times)' THEN CEIL("lesson_count" / 2.0)::integer * 7
  ELSE GREATEST("lesson_count", 1) * 7
END
WHERE "duration_days" = 0;
--> statement-breakpoint
ALTER TABLE "academy_courses" ADD COLUMN "schedule" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_courses" ADD COLUMN "description" text;
--> statement-breakpoint
ALTER TABLE "academy_lead_statuses" ADD COLUMN "is_pipeline" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "academy_lead_statuses" SET "is_pipeline" = false WHERE "code" = 'not_now';
--> statement-breakpoint
ALTER TABLE "academy_teachers" ADD COLUMN "school_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_teachers" ADD COLUMN "availability" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD COLUMN "school_id" integer;
--> statement-breakpoint
ALTER TABLE "academy_leads" ADD COLUMN "school_id" integer;
--> statement-breakpoint
ALTER TABLE "academy_students" ADD COLUMN "school_id" integer;
--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD COLUMN "school_id" integer;
--> statement-breakpoint
ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_school_id_academy_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."academy_schools"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_school_id_academy_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."academy_schools"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_students" ADD CONSTRAINT "academy_students_school_id_academy_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."academy_schools"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_school_id_academy_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."academy_schools"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_groups_school_idx" ON "academy_groups" USING btree ("school_id");
--> statement-breakpoint
CREATE INDEX "academy_leads_school_idx" ON "academy_leads" USING btree ("school_id");
--> statement-breakpoint
CREATE INDEX "academy_students_school_idx" ON "academy_students" USING btree ("school_id");
--> statement-breakpoint
CREATE INDEX "academy_lessons_school_idx" ON "academy_lessons" USING btree ("school_id");
--> statement-breakpoint
INSERT INTO "academy_schools" ("name", "code", "address", "rooms", "timezone", "is_active")
SELECT 'Cyberpark', 'cyberpark', 'Cyberpark', '[]'::jsonb, 'Asia/Tashkent', true
WHERE NOT EXISTS (SELECT 1 FROM "academy_schools");
--> statement-breakpoint
UPDATE "academy_groups"
SET "school_id" = (SELECT "id" FROM "academy_schools" ORDER BY "id" LIMIT 1)
WHERE "school_id" IS NULL;
--> statement-breakpoint
UPDATE "academy_leads"
SET "school_id" = (SELECT "id" FROM "academy_schools" ORDER BY "id" LIMIT 1)
WHERE "school_id" IS NULL;
--> statement-breakpoint
UPDATE "academy_students"
SET "school_id" = COALESCE(
  (SELECT "school_id" FROM "academy_groups" WHERE "academy_groups"."id" = "academy_students"."group_id"),
  (SELECT "id" FROM "academy_schools" ORDER BY "id" LIMIT 1)
)
WHERE "school_id" IS NULL;
--> statement-breakpoint
UPDATE "academy_lessons"
SET "school_id" = COALESCE(
  (SELECT "school_id" FROM "academy_groups" WHERE "academy_groups"."id" = "academy_lessons"."group_id"),
  (SELECT "id" FROM "academy_schools" ORDER BY "id" LIMIT 1)
)
WHERE "school_id" IS NULL;
