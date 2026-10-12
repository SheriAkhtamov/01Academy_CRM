-- Imported drafts and background preparation have a system origin, not an invented employee.
-- Existing authors and all foreign keys remain unchanged.
ALTER TABLE lms_learning_audit ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE lms_materials ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE lms_material_versions ALTER COLUMN created_by DROP NOT NULL;
