-- Existing groups and lessons keep their original curriculum and history.
ALTER TABLE academy_groups ADD COLUMN IF NOT EXISTS selected_course_lesson_ids jsonb;
ALTER TABLE academy_lessons ADD COLUMN IF NOT EXISTS course_lesson_id varchar(100);

ALTER TABLE academy_groups ADD CONSTRAINT academy_groups_course_lessons_array
  CHECK (selected_course_lesson_ids IS NULL OR
    (jsonb_typeof(selected_course_lesson_ids) = 'array' AND jsonb_array_length(selected_course_lesson_ids) > 0));
CREATE INDEX IF NOT EXISTS academy_groups_selected_course_lessons_idx
  ON academy_groups USING gin (selected_course_lesson_ids);
CREATE INDEX IF NOT EXISTS academy_lessons_course_lesson_idx
  ON academy_lessons (course_id, course_lesson_id) WHERE course_lesson_id IS NOT NULL;
