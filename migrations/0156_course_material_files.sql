ALTER TABLE lms_files ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'learning';
ALTER TABLE lms_files ADD COLUMN IF NOT EXISTS course_id integer REFERENCES academy_courses(id) ON DELETE SET NULL;
ALTER TABLE lms_files ADD CONSTRAINT lms_files_purpose_check CHECK (purpose IN ('learning','course_material'));
ALTER TABLE lms_files ADD CONSTRAINT lms_files_course_material_scope CHECK (
  (purpose='learning' AND course_id IS NULL) OR
  (purpose='course_material' AND owner_user_id IS NOT NULL AND owner_account_id IS NULL AND run_id IS NULL AND student_id IS NULL AND recipient_id IS NULL)
);
CREATE INDEX IF NOT EXISTS lms_files_course_idx ON lms_files(course_id) WHERE purpose='course_material' AND deleted_at IS NULL;
ALTER TABLE academy_lessons ADD COLUMN IF NOT EXISTS material_file_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE academy_lessons ADD CONSTRAINT academy_lessons_material_files_array CHECK (jsonb_typeof(material_file_ids)='array');
