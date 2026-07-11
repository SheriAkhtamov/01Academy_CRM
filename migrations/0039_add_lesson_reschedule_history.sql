CREATE TABLE "academy_lesson_reschedules" (
  "id" serial PRIMARY KEY NOT NULL,
  "lesson_id" integer NOT NULL,
  "previous_scheduled_at" timestamp NOT NULL,
  "next_scheduled_at" timestamp NOT NULL,
  "reason" text NOT NULL,
  "changed_by" integer,
  "created_at" timestamp DEFAULT now()
);

ALTER TABLE "academy_lesson_reschedules"
  ADD CONSTRAINT "academy_lesson_reschedules_lesson_id_academy_lessons_id_fk"
  FOREIGN KEY ("lesson_id") REFERENCES "academy_lessons"("id") ON DELETE RESTRICT;

ALTER TABLE "academy_lesson_reschedules"
  ADD CONSTRAINT "academy_lesson_reschedules_changed_by_users_id_fk"
  FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "academy_lesson_reschedules_lesson_idx"
  ON "academy_lesson_reschedules" ("lesson_id");
