-- A future group keeps its identity while its room, teacher and start are being agreed.
ALTER TABLE academy_groups ALTER COLUMN room_id DROP NOT NULL;
ALTER TABLE academy_groups ADD CONSTRAINT academy_groups_room_required_for_teaching
  CHECK (status = 'planned' OR room_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS academy_groups_planned_start_idx
  ON academy_groups (start_date, id) WHERE status = 'planned' AND is_archived = false;
