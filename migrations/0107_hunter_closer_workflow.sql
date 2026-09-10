ALTER TABLE academy_sales_funnels ADD COLUMN workflow_role varchar(20)
  CHECK (workflow_role IN ('hunter', 'closer'));
CREATE UNIQUE INDEX academy_sales_funnels_workflow_role_unique
  ON academy_sales_funnels(workflow_role) WHERE workflow_role IS NOT NULL;
UPDATE academy_sales_funnels SET workflow_role = 'hunter' WHERE is_default;
--> statement-breakpoint
DO $$
DECLARE candidate text := 'Воронка клозеров'; suffix integer := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM academy_sales_funnels WHERE lower(btrim(name)) = lower(candidate)) LOOP
    suffix := suffix + 1;
    candidate := 'Воронка клозеров ' || suffix;
  END LOOP;
  INSERT INTO academy_sales_funnels(name, workflow_role) VALUES (candidate, 'closer');
END $$;
--> statement-breakpoint
CREATE TABLE academy_lead_funnel_handoffs (
  lead_id integer PRIMARY KEY REFERENCES academy_leads(id) ON DELETE CASCADE,
  from_funnel_id integer NOT NULL REFERENCES academy_sales_funnels(id) ON DELETE RESTRICT,
  from_manager_id integer REFERENCES users(id) ON DELETE SET NULL,
  demo_lesson_id integer REFERENCES academy_demo_lessons(id) ON DELETE SET NULL,
  handed_off_at timestamp NOT NULL DEFAULT timezone('UTC', now()),
  returned_at timestamp
);
ALTER TABLE academy_lead_assignment_history ALTER COLUMN to_manager_id DROP NOT NULL;
--> statement-breakpoint
-- Freeze the hunter before clearing the operational owner. Existing KPI facts
-- are never reassigned, and historical payments are not reclassified.
SELECT academy_kpi_touch_lead(lead.id)
FROM academy_leads lead JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
WHERE funnel.workflow_role = 'hunter';
--> statement-breakpoint
INSERT INTO academy_lead_funnel_handoffs(lead_id, from_funnel_id, from_manager_id, demo_lesson_id)
SELECT lead.id, lead.funnel_id, lead.manager_id,
  (SELECT demo.id FROM academy_demo_lesson_participants participant
   JOIN academy_students student ON student.id = participant.student_id
   JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
   WHERE student.lead_id = lead.id AND participant.status = 'attended'
     AND demo.status IN ('scheduled', 'completed')
   ORDER BY demo.scheduled_at DESC, demo.id DESC LIMIT 1)
FROM academy_leads lead JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
WHERE funnel.workflow_role = 'hunter' AND lead.status_code = 'demo_attended'
  AND NOT lead.is_archived
  AND academy_kpi_employee_role(lead.manager_id) IS DISTINCT FROM 'closer';
--> statement-breakpoint
CREATE FUNCTION academy_sales_stage_role(p_code text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_code IN ('new_request', 'first_contact', 'qualified', 'demo_invited', 'ne_prishli_na_vstrechu') THEN 'hunter'
    WHEN p_code IN ('demo_attended', 'offer', 'thinking', 'enrolled', 'paid') THEN 'closer'
    WHEN stage.sort_order < COALESCE((SELECT sort_order FROM academy_lead_statuses WHERE code = 'demo_attended'), 50)
      THEN 'hunter' ELSE 'closer' END
  FROM academy_lead_statuses stage WHERE stage.code = p_code
$$;
--> statement-breakpoint
-- Move later stages with their existing owners; do not make in-progress sales
-- or paid clients unassigned. Only the initial demo queue releases its owner.
UPDATE academy_leads lead
SET funnel_id = (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'closer'),
    updated_at = timezone('UTC', now())
FROM academy_sales_funnels funnel
WHERE funnel.id = lead.funnel_id AND funnel.workflow_role = 'hunter'
  AND academy_sales_stage_role(lead.status_code) = 'closer' AND lead.status_code <> 'not_now';
INSERT INTO academy_lead_assignment_history(lead_id, from_manager_id, to_manager_id, comment)
SELECT lead_id, from_manager_id, NULL, 'Передан в очередь клозеров после демо'
FROM academy_lead_funnel_handoffs;
UPDATE academy_leads SET manager_id = NULL, first_viewed_at = NULL, first_viewed_by = NULL
WHERE id IN (SELECT lead_id FROM academy_lead_funnel_handoffs);
UPDATE academy_students SET manager_id = NULL, updated_at = timezone('UTC', now())
WHERE lead_id IN (SELECT lead_id FROM academy_lead_funnel_handoffs);
UPDATE academy_tasks SET responsible_id = NULL, updated_at = timezone('UTC', now())
WHERE status <> 'done' AND (
  (entity_type = 'lead' AND entity_id IN (SELECT lead_id FROM academy_lead_funnel_handoffs))
  OR (entity_type = 'student' AND entity_id IN (SELECT id FROM academy_students
    WHERE lead_id IN (SELECT lead_id FROM academy_lead_funnel_handoffs)))
);
UPDATE board_tasks SET assignee_id = NULL, updated_at = timezone('UTC', now())
WHERE status NOT IN ('done', 'accepted') AND lead_id IN (SELECT lead_id FROM academy_lead_funnel_handoffs);
--> statement-breakpoint
CREATE FUNCTION protect_sales_workflow_funnels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workflow_role IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'salesWorkflowFunnelProtected'; END IF;
    IF NEW.workflow_role IS DISTINCT FROM OLD.workflow_role OR NOT NEW.is_active
      OR (OLD.workflow_role = 'hunter' AND NOT NEW.is_default)
      OR (OLD.workflow_role = 'closer' AND NEW.is_default) THEN
      RAISE EXCEPTION 'salesWorkflowFunnelProtected';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER academy_protect_sales_workflow_funnels BEFORE UPDATE OR DELETE ON academy_sales_funnels
  FOR EACH ROW EXECUTE FUNCTION protect_sales_workflow_funnels();
--> statement-breakpoint
CREATE FUNCTION protect_sales_workflow_lead() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text; assigned_role text;
BEGIN
  SELECT workflow_role INTO phase FROM academy_sales_funnels WHERE id = NEW.funnel_id;
  IF phase IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR NEW.status_code IS DISTINCT FROM OLD.status_code
    OR NEW.funnel_id IS DISTINCT FROM OLD.funnel_id THEN
    IF NEW.status_code <> 'not_now' AND academy_sales_stage_role(NEW.status_code) IS DISTINCT FROM phase THEN
      RAISE EXCEPTION 'salesFunnelStageUnavailable';
    END IF;
  END IF;
  IF NEW.manager_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.manager_id IS DISTINCT FROM OLD.manager_id) THEN
    assigned_role := academy_kpi_employee_role(NEW.manager_id);
    IF phase = 'closer' AND assigned_role IS DISTINCT FROM 'closer' THEN RAISE EXCEPTION 'salesFunnelCloserOnly'; END IF;
    IF phase = 'hunter' AND assigned_role = 'closer' THEN RAISE EXCEPTION 'salesFunnelHunterOnly'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER academy_protect_sales_workflow_lead BEFORE INSERT OR UPDATE ON academy_leads
  FOR EACH ROW EXECUTE FUNCTION protect_sales_workflow_lead();
--> statement-breakpoint
-- A booking happens when a student is enrolled in a demo (invited), not when
-- attendance is later marked. Retries and corrections keep the original fact.
CREATE OR REPLACE FUNCTION academy_kpi_capture_trial() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_lead integer; assigned_manager integer; tracked academy_sales_kpi_leads%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('invited', 'confirmed', 'attended', 'no_show') THEN RETURN NEW; END IF;
  SELECT lead_id, manager_id INTO linked_lead, assigned_manager FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  SELECT * INTO tracked FROM academy_sales_kpi_leads WHERE lead_id = linked_lead;
  IF tracked.lead_id IS NULL OR NEW.created_at < tracked.tracked_at THEN RETURN NEW; END IF;
  INSERT INTO academy_sales_kpi_trials(participant_id, hunter_id, closer_id, booked_at, reactivated)
  VALUES (NEW.id, tracked.hunter_id, tracked.closer_id, NEW.created_at,
    COALESCE(tracked.reactivated_at IS NOT NULL AND tracked.reactivated_at <= NEW.created_at, false))
  ON CONFLICT (participant_id) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Include existing post-launch invitations whose booking owner is already
-- known. Do not attribute pre-KPI invitations to today's manager.
INSERT INTO academy_sales_kpi_trials(participant_id, hunter_id, closer_id, booked_at, reactivated)
SELECT participant.id, tracked.hunter_id, tracked.closer_id, participant.created_at,
  COALESCE(tracked.reactivated_at IS NOT NULL AND tracked.reactivated_at <= participant.created_at, false)
FROM academy_demo_lesson_participants participant
JOIN academy_students student ON student.id = participant.student_id
JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = student.lead_id
WHERE participant.status IN ('invited', 'confirmed', 'attended', 'no_show')
  AND participant.created_at >= tracked.tracked_at
ON CONFLICT (participant_id) DO NOTHING;
