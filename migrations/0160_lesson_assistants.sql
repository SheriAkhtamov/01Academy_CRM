CREATE TABLE IF NOT EXISTS academy_lesson_assistants (
  lesson_id integer NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  teacher_id integer NOT NULL REFERENCES academy_teachers(id) ON DELETE CASCADE,
  assigned_by integer REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS academy_lesson_assistants_teacher_idx
  ON academy_lesson_assistants (teacher_id, lesson_id);

CREATE OR REPLACE FUNCTION academy_check_lesson_assistant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE main_teacher_id integer;
BEGIN
  SELECT teacher_id INTO main_teacher_id FROM academy_lessons WHERE id=NEW.lesson_id FOR UPDATE;
  IF main_teacher_id=NEW.teacher_id THEN
    RAISE EXCEPTION 'Primary teacher cannot also be an assistant' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS academy_check_lesson_assistant ON academy_lesson_assistants;
CREATE TRIGGER academy_check_lesson_assistant BEFORE INSERT OR UPDATE ON academy_lesson_assistants
  FOR EACH ROW EXECUTE FUNCTION academy_check_lesson_assistant();

CREATE OR REPLACE FUNCTION academy_promote_lesson_assistant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM academy_lesson_assistants WHERE lesson_id=NEW.id AND teacher_id=NEW.teacher_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS academy_promote_lesson_assistant ON academy_lessons;
CREATE TRIGGER academy_promote_lesson_assistant AFTER UPDATE OF teacher_id ON academy_lessons
  FOR EACH ROW WHEN (OLD.teacher_id IS DISTINCT FROM NEW.teacher_id)
  EXECUTE FUNCTION academy_promote_lesson_assistant();
