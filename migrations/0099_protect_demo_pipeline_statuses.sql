-- Reuse the existing no-show code; do not duplicate the production stage or
-- rewrite any lead's historical stage. Preserve administrators' labels/order.
INSERT INTO academy_lead_statuses (code, name, color, sort_order, is_pipeline, is_system, is_active)
VALUES
  ('ne_prishli_na_vstrechu', 'Не пришли на встречу', '#ef4444', 45, true, true, true),
  ('demo_attended', 'Встреча проведена', '#a855f7', 50, true, true, true)
ON CONFLICT (code) DO UPDATE
SET is_pipeline = true, is_system = true, is_active = true, updated_at = NOW();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_demo_pipeline_statuses() RETURNS trigger AS $$
BEGIN
  IF OLD.code IN ('demo_attended', 'ne_prishli_na_vstrechu') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'systemPipelineStageCannotBeDeleted';
    END IF;
    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.is_system IS DISTINCT FROM true
       OR NEW.is_active IS DISTINCT FROM true
       OR NEW.is_pipeline IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'demoPipelineStageProtected';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER academy_protect_demo_pipeline_statuses
BEFORE UPDATE OR DELETE ON academy_lead_statuses
FOR EACH ROW EXECUTE FUNCTION protect_demo_pipeline_statuses();
