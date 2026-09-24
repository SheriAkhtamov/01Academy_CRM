ALTER TABLE academy_lead_statuses
  ADD COLUMN funnel_id integer REFERENCES academy_sales_funnels(id) ON DELETE CASCADE;
CREATE INDEX academy_lead_statuses_funnel_id_idx ON academy_lead_statuses(funnel_id);
--> statement-breakpoint
-- Existing built-in stages remain shared. An existing custom stage is assigned
-- only when its current leads do not span multiple funnels.
UPDATE academy_lead_statuses stage
SET funnel_id = owner.funnel_id
FROM (
  SELECT stage.id,
         CASE WHEN COUNT(DISTINCT lead.funnel_id) = 1 THEN MIN(lead.funnel_id)
              WHEN COUNT(lead.id) = 0 THEN (
                SELECT funnel.id FROM academy_sales_funnels funnel
                WHERE funnel.workflow_role = academy_sales_stage_role(stage.code)
                LIMIT 1
              )
              ELSE NULL END AS funnel_id
  FROM academy_lead_statuses stage
  LEFT JOIN academy_leads lead ON lead.status_code = stage.code
  WHERE stage.is_system = false
    AND stage.code NOT IN ('nedozvon', 'perezvonit_pozzhe', 'ozhi')
  GROUP BY stage.id, stage.code
) owner
WHERE stage.id = owner.id AND owner.funnel_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_sales_stage_role(p_code text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT funnel.workflow_role FROM academy_sales_funnels funnel WHERE funnel.id = stage.funnel_id),
    CASE
      WHEN stage.code IN ('new_request', 'first_contact', 'qualified', 'demo_invited', 'ne_prishli_na_vstrechu') THEN 'hunter'
      WHEN stage.code IN ('demo_attended', 'offer', 'thinking', 'enrolled', 'paid') THEN 'closer'
      WHEN stage.sort_order < COALESCE((SELECT sort_order FROM academy_lead_statuses WHERE code = 'demo_attended'), 50)
        THEN 'hunter' ELSE 'closer' END
  )
  FROM academy_lead_statuses stage WHERE stage.code = p_code
$$;
--> statement-breakpoint
CREATE FUNCTION protect_scoped_sales_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stage_funnel_id integer;
BEGIN
  IF NEW.status_code = 'not_now' THEN RETURN NEW; END IF;
  SELECT funnel_id INTO stage_funnel_id FROM academy_lead_statuses WHERE code = NEW.status_code;
  IF stage_funnel_id IS NOT NULL AND stage_funnel_id IS DISTINCT FROM NEW.funnel_id THEN
    RAISE EXCEPTION 'salesFunnelStageUnavailable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER academy_protect_scoped_sales_stage
  BEFORE INSERT OR UPDATE OF status_code, funnel_id ON academy_leads
  FOR EACH ROW EXECUTE FUNCTION protect_scoped_sales_stage();
