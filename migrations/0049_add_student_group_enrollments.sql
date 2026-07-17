CREATE TABLE "academy_student_group_enrollments" (
  "id" serial PRIMARY KEY NOT NULL,
  "student_id" integer NOT NULL,
  "group_id" integer NOT NULL,
  "status" varchar(30) DEFAULT 'active' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "enrolled_at" timestamp DEFAULT now() NOT NULL,
  "ended_at" timestamp,
  "created_by" integer,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "academy_student_group_enrollments_status_check"
    CHECK ("status" IN ('active', 'withdrawn', 'completed')),
  CONSTRAINT "academy_student_group_enrollments_dates_check"
    CHECK ("ended_at" IS NULL OR "ended_at" >= "enrolled_at")
);
--> statement-breakpoint
ALTER TABLE "academy_student_group_enrollments"
  ADD CONSTRAINT "academy_student_group_enrollments_student_id_academy_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_student_group_enrollments"
  ADD CONSTRAINT "academy_student_group_enrollments_group_id_academy_groups_id_fk"
  FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_student_group_enrollments"
  ADD CONSTRAINT "academy_student_group_enrollments_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_student_group_enrollments_student_status_idx"
  ON "academy_student_group_enrollments" USING btree ("student_id", "status");
--> statement-breakpoint
CREATE INDEX "academy_student_group_enrollments_group_status_idx"
  ON "academy_student_group_enrollments" USING btree ("group_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_student_group_enrollments_active_unique"
  ON "academy_student_group_enrollments" USING btree ("student_id", "group_id")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_student_group_enrollments_active_primary_unique"
  ON "academy_student_group_enrollments" USING btree ("student_id")
  WHERE "status" = 'active' AND "is_primary" = true;
--> statement-breakpoint
INSERT INTO "academy_student_group_enrollments"
  ("student_id", "group_id", "status", "is_primary", "enrolled_at", "created_at", "updated_at")
SELECT
  student."id",
  student."group_id",
  'active',
  true,
  COALESCE(
    (
      SELECT MAX(transfer."created_at")
      FROM "academy_student_transfers" transfer
      WHERE transfer."student_id" = student."id"
        AND transfer."to_group_id" = student."group_id"
    ),
    student."enrolled_at",
    student."enrollment_date",
    student."created_at",
    NOW()
  ),
  COALESCE(student."created_at", NOW()),
  NOW()
FROM "academy_students" student
WHERE student."group_id" IS NOT NULL
ON CONFLICT ("student_id", "group_id") WHERE "status" = 'active' DO NOTHING;
--> statement-breakpoint
DROP INDEX IF EXISTS "academy_lead_phones_normalized_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_lead_phones_lead_normalized_unique"
  ON "academy_lead_phones" USING btree ("lead_id", "normalized_phone");
--> statement-breakpoint
CREATE INDEX "academy_lead_phones_normalized_idx"
  ON "academy_lead_phones" USING btree ("normalized_phone");
