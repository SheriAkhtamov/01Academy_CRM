-- Stages are funnel-owned labels. Only the configured first stage handles intake.
-- Disable legacy phase/attendance logic during the label-preserving conversion.
DROP TRIGGER IF EXISTS academy_protect_sales_workflow_lead ON academy_leads;
DROP TRIGGER IF EXISTS academy_protect_demo_pipeline_statuses ON academy_lead_statuses;
DROP FUNCTION IF EXISTS protect_demo_pipeline_statuses();
DROP TRIGGER IF EXISTS academy_protect_scoped_sales_stage ON academy_leads;
DROP TRIGGER IF EXISTS academy_auto_distribute_lead ON academy_leads;
DROP TRIGGER IF EXISTS academy_kpi_lead_capture ON academy_leads;
DROP TRIGGER IF EXISTS academy_protect_sales_funnel_user_assignment ON academy_leads;
ALTER TABLE academy_sales_funnels ADD COLUMN initial_stage_code varchar(80);
ALTER TABLE academy_leads ALTER COLUMN status_code DROP DEFAULT;
ALTER TABLE academy_lead_funnel_handoffs DROP CONSTRAINT IF EXISTS academy_lead_funnel_handoffs_from_funnel_id_fkey;
ALTER TABLE academy_lead_stage_history
 ADD COLUMN from_funnel_id integer,
 ADD COLUMN to_funnel_id integer,
 ADD COLUMN from_status_name text,
 ADD COLUMN to_status_name text;
UPDATE academy_lead_stage_history history SET
 from_status_name = (SELECT name FROM academy_lead_statuses WHERE code = history.from_status_code),
 to_status_name = (SELECT name FROM academy_lead_statuses WHERE code = history.to_status_code);
--> statement-breakpoint
-- Snapshot the previous visible stage sets before assigning shared labels.
CREATE TEMP TABLE academy_stage_scope_conversion ON COMMIT DROP AS
SELECT stage.*, academy_sales_stage_role(stage.code) AS legacy_role
FROM academy_lead_statuses stage;
CREATE TEMP TABLE academy_stage_scope_mapping (
  old_code varchar(80), funnel_id integer, new_code varchar(80), PRIMARY KEY(old_code, funnel_id)
) ON COMMIT DROP;
DO $$
DECLARE v_stage record; v_funnel record; owner integer; scoped_code text; initial_code text; collision_suffix integer;
BEGIN
  FOR v_stage IN SELECT * FROM academy_stage_scope_conversion ORDER BY id LOOP
    IF v_stage.funnel_id IS NOT NULL THEN
      INSERT INTO academy_stage_scope_mapping VALUES(v_stage.code, v_stage.funnel_id, v_stage.code);
      CONTINUE;
    END IF;
    SELECT f.id INTO owner FROM academy_sales_funnels f
    WHERE f.workflow_role IS NULL OR f.workflow_role = v_stage.legacy_role
       OR EXISTS (SELECT 1 FROM academy_leads l WHERE l.funnel_id = f.id AND l.status_code = v_stage.code)
    ORDER BY (SELECT COUNT(*) FROM academy_leads l WHERE l.funnel_id = f.id AND l.status_code = v_stage.code) DESC,
             f.is_default DESC, f.id LIMIT 1;
    IF owner IS NULL THEN SELECT id INTO owner FROM academy_sales_funnels ORDER BY is_default DESC, id LIMIT 1; END IF;
    UPDATE academy_lead_statuses SET funnel_id = owner, is_system = false WHERE id = v_stage.id;
    INSERT INTO academy_stage_scope_mapping VALUES(v_stage.code, owner, v_stage.code);
    FOR v_funnel IN SELECT * FROM academy_sales_funnels f WHERE f.id <> owner AND (
      f.workflow_role IS NULL OR f.workflow_role = v_stage.legacy_role
      OR NOT v_stage.is_pipeline
      OR EXISTS (SELECT 1 FROM academy_leads l WHERE l.funnel_id = f.id AND l.status_code = v_stage.code)
    ) LOOP
      scoped_code := left(v_stage.code, 40) || '_f' || v_funnel.id || '_s' || v_stage.id;
      collision_suffix := 1;
      WHILE EXISTS(SELECT 1 FROM academy_lead_statuses WHERE code = scoped_code) LOOP
        scoped_code := left(v_stage.code, 30) || '_f' || v_funnel.id || '_s' || v_stage.id || '_copy' || collision_suffix;
        collision_suffix := collision_suffix + 1;
      END LOOP;
      INSERT INTO academy_lead_statuses(code, name, color, sort_order, is_pipeline, is_system, is_active, funnel_id)
      VALUES(scoped_code, v_stage.name, v_stage.color, v_stage.sort_order, v_stage.is_pipeline, false, v_stage.is_active, v_funnel.id);
      INSERT INTO academy_stage_scope_mapping VALUES(v_stage.code, v_funnel.id, scoped_code);
    END LOOP;
  END LOOP;
  UPDATE academy_leads lead SET status_code = map.new_code
  FROM academy_stage_scope_mapping map
  WHERE map.old_code = lead.status_code AND map.funnel_id = lead.funnel_id;
  FOR v_funnel IN SELECT * FROM academy_sales_funnels ORDER BY id LOOP
    -- Preserve the first visible stage, including the old closer queue's first label.
    SELECT map.new_code INTO initial_code FROM academy_stage_scope_mapping map
      WHERE map.funnel_id = v_funnel.id AND map.old_code = CASE
        WHEN v_funnel.workflow_role = 'closer' THEN 'demo_attended'
        WHEN v_funnel.is_default OR v_funnel.workflow_role = 'hunter' THEN 'new_request' END;
    IF initial_code IS NULL THEN
    SELECT current_stage.code INTO initial_code FROM academy_lead_statuses current_stage
    WHERE current_stage.funnel_id = v_funnel.id AND current_stage.is_active AND current_stage.is_pipeline
    ORDER BY current_stage.sort_order, current_stage.id LIMIT 1;
    END IF;
    IF initial_code IS NULL THEN
      initial_code := 'funnel_' || v_funnel.id || '_intake';
      collision_suffix := 1;
      WHILE EXISTS(SELECT 1 FROM academy_lead_statuses WHERE code = initial_code) LOOP
        initial_code := 'funnel_' || v_funnel.id || '_intake_' || collision_suffix;
        collision_suffix := collision_suffix + 1;
      END LOOP;
      INSERT INTO academy_lead_statuses(code, name, color, sort_order, is_pipeline, is_system, is_active, funnel_id)
      VALUES(initial_code, v_funnel.name, '#2563eb', 0, true, false, true, v_funnel.id);
    END IF;
    UPDATE academy_lead_statuses SET is_active = true, is_pipeline = true WHERE code = initial_code;
    UPDATE academy_sales_funnels SET initial_stage_code = initial_code WHERE id = v_funnel.id;
    UPDATE academy_lead_statuses SET sort_order = 0 WHERE code = initial_code;
    WITH ranked AS (
      SELECT id, row_number() OVER(ORDER BY sort_order, id) AS ordinal
      FROM academy_lead_statuses WHERE funnel_id = v_funnel.id AND code <> initial_code
    ) UPDATE academy_lead_statuses ranked_stage SET sort_order = ranked.ordinal * 10
      FROM ranked WHERE ranked_stage.id = ranked.id;
  END LOOP;
END $$;
UPDATE academy_lead_statuses SET is_system = false;
ALTER TABLE academy_lead_statuses ALTER COLUMN funnel_id SET NOT NULL;
ALTER TABLE academy_sales_funnels ADD CONSTRAINT academy_sales_funnels_initial_stage_fk
 FOREIGN KEY(initial_stage_code) REFERENCES academy_lead_statuses(code) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- Qualification is a durable fact for one lead in one funnel. Funnel identities
-- and names remain in this ledger even after an empty funnel is deleted.
CREATE TABLE academy_lead_funnel_qualifications (
 lead_id integer NOT NULL REFERENCES academy_leads(id) ON DELETE CASCADE,
 funnel_id integer NOT NULL,
 funnel_name varchar(120) NOT NULL,
 qualified_at timestamp NOT NULL DEFAULT timezone('UTC', now()),
 qualified_by integer REFERENCES users(id) ON DELETE SET NULL,
 from_stage_code varchar(80) NOT NULL,
 to_stage_code varchar(80) NOT NULL,
 PRIMARY KEY(lead_id, funnel_id)
);
CREATE INDEX academy_lead_funnel_qualifications_funnel_date_idx
 ON academy_lead_funnel_qualifications(funnel_id, qualified_at);
-- Legacy qualification timestamps came from profile completion and arbitrary
-- stage thresholds. Keep those historical rows, but never use them as new facts.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_scoped_sales_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM academy_lead_statuses stage
   WHERE stage.code = NEW.status_code AND stage.funnel_id = NEW.funnel_id
     AND stage.is_active AND stage.is_pipeline) THEN
   IF TG_OP = 'UPDATE' AND NEW.status_code IS NOT DISTINCT FROM OLD.status_code
      AND NEW.funnel_id IS NOT DISTINCT FROM OLD.funnel_id THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'salesFunnelStageUnavailable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER academy_protect_scoped_sales_stage BEFORE INSERT OR UPDATE OF status_code, funnel_id
 ON academy_leads FOR EACH ROW EXECUTE FUNCTION protect_scoped_sales_stage();
DROP FUNCTION IF EXISTS protect_sales_workflow_lead();
DROP TRIGGER IF EXISTS academy_protect_sales_workflow_funnels ON academy_sales_funnels;
DROP FUNCTION IF EXISTS protect_sales_workflow_funnels();
CREATE OR REPLACE FUNCTION protect_sales_funnel_user_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id
   AND NEW.funnel_id IS NOT DISTINCT FROM OLD.funnel_id THEN RETURN NEW; END IF;
 IF NEW.manager_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM academy_sales_funnel_users
   WHERE user_id = NEW.manager_id AND funnel_id = NEW.funnel_id) THEN RAISE EXCEPTION 'salesFunnelNotAssigned'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER academy_protect_sales_funnel_user_assignment BEFORE INSERT OR UPDATE OF manager_id, funnel_id
 ON academy_leads FOR EACH ROW EXECUTE FUNCTION protect_sales_funnel_user_assignment();
--> statement-breakpoint
CREATE FUNCTION protect_sales_initial_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE is_initial boolean; configured_initial text;
BEGIN
 IF TG_OP = 'INSERT' THEN
   SELECT initial_stage_code INTO configured_initial FROM academy_sales_funnels WHERE id = NEW.funnel_id;
   IF configured_initial IS NOT NULL AND configured_initial IS DISTINCT FROM NEW.code AND NEW.sort_order <= 0 THEN
     RAISE EXCEPTION 'invalidData';
   END IF;
   RETURN NEW;
 END IF;
 SELECT EXISTS(SELECT 1 FROM academy_sales_funnels WHERE initial_stage_code = OLD.code) INTO is_initial;
 IF TG_OP = 'DELETE' THEN
   IF is_initial THEN RAISE EXCEPTION 'pipelineInitialStageCannotBeDeleted'; END IF;
   RETURN OLD;
 END IF;
 IF is_initial AND (NEW.is_active = false OR NEW.is_pipeline = false
   OR NEW.sort_order IS DISTINCT FROM OLD.sort_order OR NEW.funnel_id IS DISTINCT FROM OLD.funnel_id
   OR NEW.code IS DISTINCT FROM OLD.code) THEN RAISE EXCEPTION 'pipelineInitialStageProtected'; END IF;
 IF NOT is_initial AND NEW.sort_order <= 0 THEN RAISE EXCEPTION 'invalidData'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER academy_protect_sales_initial_stage BEFORE INSERT OR UPDATE OR DELETE ON academy_lead_statuses
 FOR EACH ROW EXECUTE FUNCTION protect_sales_initial_stage();
DROP FUNCTION IF EXISTS academy_transition_demo_lead(integer,text,boolean,integer,integer,text);
DROP FUNCTION IF EXISTS academy_sales_stage_role(text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_auto_distribute_lead() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_manager integer;
BEGIN
 IF NEW.manager_id IS NULL AND COALESCE(NEW.is_archived, false) = false
   AND EXISTS(SELECT 1 FROM academy_sales_funnels WHERE id = NEW.funnel_id AND initial_stage_code = NEW.status_code) THEN
   selected_manager := academy_next_auto_lead_manager(NEW.funnel_id);
   IF selected_manager IS NOT NULL THEN NEW.manager_id := selected_manager;
     NEW.first_viewed_at := NULL; NEW.first_viewed_by := NULL; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER academy_auto_distribute_lead BEFORE INSERT OR UPDATE OF manager_id, status_code, funnel_id, is_archived
 ON academy_leads FOR EACH ROW EXECUTE FUNCTION academy_auto_distribute_lead();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_kpi_touch_lead(p_lead integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  lead academy_leads%ROWTYPE;
  assigned_role text;
  tracking_start timestamp;
BEGIN
  IF p_lead IS NULL THEN RETURN; END IF;
  SELECT * INTO lead FROM academy_leads WHERE id = p_lead;
  IF NOT FOUND THEN RETURN; END IF;
  assigned_role := academy_kpi_employee_role(lead.manager_id);
  IF assigned_role IS NULL AND NOT EXISTS (SELECT 1 FROM academy_sales_kpi_leads WHERE lead_id = p_lead) THEN RETURN; END IF;
  SELECT GREATEST(meta.tracking_started_at, assignment.created_at,
    (assignment.effective_month || '-01')::date::timestamp - interval '5 hours') INTO tracking_start
  FROM academy_sales_kpi_meta meta LEFT JOIN LATERAL (
    SELECT effective_month, created_at FROM academy_sales_kpi_assignments
    WHERE user_id = lead.manager_id
      AND effective_month <= to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
    ORDER BY effective_month DESC LIMIT 1
  ) assignment ON true WHERE meta.id = 1;
  INSERT INTO academy_sales_kpi_leads (lead_id, hunter_id, closer_id, received_at, tracked_at)
  VALUES (lead.id, CASE WHEN assigned_role IN ('hunter', 'closer', 'full_cycle', 'full_cycle_3500') THEN lead.manager_id END,
    CASE WHEN assigned_role IN ('closer', 'full_cycle', 'full_cycle_3500') THEN lead.manager_id END, lead.created_at, tracking_start)
  ON CONFLICT (lead_id) DO UPDATE SET
    hunter_id = COALESCE(academy_sales_kpi_leads.hunter_id, EXCLUDED.hunter_id),
    closer_id = COALESCE(academy_sales_kpi_leads.closer_id, EXCLUDED.closer_id);
  IF lead.is_archived THEN
    INSERT INTO academy_sales_kpi_activity (lead_id, kind, source_key)
    SELECT lead.id, 'cold', 'initial-cold:' || lead.id
    WHERE NOT EXISTS (SELECT 1 FROM academy_sales_kpi_activity
      WHERE lead_id = lead.id AND kind IN ('cold', 'reactivated'))
    ON CONFLICT DO NOTHING;
  END IF;
  UPDATE academy_sales_kpi_trials trial SET closer_id = tracked.closer_id
  FROM academy_demo_lesson_participants participant, academy_students student, academy_sales_kpi_leads tracked
  WHERE trial.participant_id = participant.id AND participant.student_id = student.id
    AND student.lead_id = p_lead AND tracked.lead_id = p_lead
    AND trial.closer_id IS NULL AND tracked.closer_id IS NOT NULL;
END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_kpi_capture_lead() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  clock_at timestamp := timezone('UTC', now());
  was_complete boolean := false;
  is_complete boolean;
  was_cold boolean := false;
  is_cold boolean;
BEGIN
  PERFORM academy_kpi_touch_lead(NEW.id);
  IF NOT EXISTS (SELECT 1 FROM academy_sales_kpi_leads WHERE lead_id = NEW.id) THEN RETURN NEW; END IF;
  is_complete := NEW.student_age IS NOT NULL AND NEW.student_age > 0 AND NEW.course_id IS NOT NULL
    AND COALESCE(NULLIF(btrim(NEW.phone), ''), NULLIF(btrim(NEW.messenger), '')) IS NOT NULL
    AND NULLIF(btrim(NEW.contact_name), '') IS NOT NULL;
  is_cold := NEW.is_archived;
  IF TG_OP = 'UPDATE' THEN
    was_complete := OLD.student_age IS NOT NULL AND OLD.student_age > 0 AND OLD.course_id IS NOT NULL
      AND COALESCE(NULLIF(btrim(OLD.phone), ''), NULLIF(btrim(OLD.messenger), '')) IS NOT NULL
      AND NULLIF(btrim(OLD.contact_name), '') IS NOT NULL;
    was_cold := OLD.is_archived;
  END IF;
  IF is_complete THEN
    UPDATE academy_sales_kpi_leads SET crm_completed_at = COALESCE(crm_completed_at, clock_at)
    WHERE lead_id = NEW.id;
  END IF;
  IF NEW.first_contact_at IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.first_contact_at IS DISTINCT FROM OLD.first_contact_at) THEN
    PERFORM academy_kpi_record_contact(NEW.id, clock_at, 'lead-contact:' || NEW.id || ':' || clock_at::text);
  END IF;
  IF NEW.offer_at IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.offer_at IS DISTINCT FROM OLD.offer_at) THEN
    UPDATE academy_sales_kpi_leads SET offer_at = COALESCE(offer_at, clock_at) WHERE lead_id = NEW.id;
  END IF;
  IF is_cold AND NOT was_cold THEN
    INSERT INTO academy_sales_kpi_activity (lead_id, kind, source_key, occurred_at)
    VALUES (NEW.id, 'cold', 'cold:' || NEW.id || ':' || clock_at::text, clock_at) ON CONFLICT DO NOTHING;
  ELSIF was_cold AND NOT is_cold THEN
    UPDATE academy_sales_kpi_leads SET reactivated_at = clock_at WHERE lead_id = NEW.id;
    INSERT INTO academy_sales_kpi_activity (lead_id, kind, source_key, occurred_at)
    VALUES (NEW.id, 'reactivated', 'reactivated:' || NEW.id || ':' || clock_at::text, clock_at) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER academy_kpi_lead_capture AFTER INSERT OR UPDATE ON academy_leads
 FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_lead();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_next_auto_lead_manager(p_funnel_id integer)
RETURNS integer LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  settings_row academy_company_settings%ROWTYPE;
  manager_ids integer[];
  manager_count integer;
  selected_manager integer;
BEGIN
  SELECT * INTO settings_row
  FROM academy_company_settings
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR settings_row.auto_lead_distribution_enabled IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM academy_sales_funnels funnel
    WHERE funnel.id = p_funnel_id
      AND funnel.is_active = true
      AND funnel.is_default = true
  ) THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(employee.id ORDER BY employee.id)
  INTO manager_ids
  FROM academy_sales_funnel_users assignment
  JOIN users employee ON employee.id = assignment.user_id
  WHERE assignment.funnel_id = p_funnel_id
    AND employee.is_active = true
    AND employee.is_archived = false
    AND (
      employee.module = 'sales'
      OR EXISTS (
        SELECT 1 FROM user_modules access
        WHERE access.user_id = employee.id AND access.module = 'sales'
      )
    )
    ;

  manager_count := COALESCE(array_length(manager_ids, 1), 0);
  IF manager_count = 0 THEN RETURN NULL; END IF;

  selected_manager := manager_ids[((settings_row.auto_lead_distribution_cursor % manager_count) + 1)::integer];
  UPDATE academy_company_settings
  SET auto_lead_distribution_cursor = auto_lead_distribution_cursor + 1,
      updated_at = timezone('UTC', now())
  WHERE id = settings_row.id;

  RETURN selected_manager;
END $$;

--> statement-breakpoint
CREATE FUNCTION academy_snapshot_lead_stage_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_funnel integer;
BEGIN
 SELECT funnel_id INTO current_funnel FROM academy_leads WHERE id = NEW.lead_id;
 IF NEW.to_funnel_id IS NULL THEN NEW.to_funnel_id := current_funnel; END IF;
 IF NEW.from_funnel_id IS NULL AND NEW.from_status_code IS NOT NULL THEN NEW.from_funnel_id := current_funnel; END IF;
 IF NEW.from_status_name IS NULL THEN
   SELECT name INTO NEW.from_status_name FROM academy_lead_statuses WHERE code = NEW.from_status_code;
 END IF;
 IF NEW.to_status_name IS NULL THEN
   SELECT name INTO NEW.to_status_name FROM academy_lead_statuses WHERE code = NEW.to_status_code;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER academy_snapshot_lead_stage_history BEFORE INSERT ON academy_lead_stage_history
 FOR EACH ROW EXECUTE FUNCTION academy_snapshot_lead_stage_history();

--> statement-breakpoint
ALTER TABLE meta_conversion_events ALTER COLUMN crm_stage DROP NOT NULL;
ALTER TABLE meta_conversion_events DROP CONSTRAINT meta_conversion_events_status_check;
ALTER TABLE meta_conversion_events ADD CONSTRAINT meta_conversion_events_status_check
 CHECK(status IN ('pending','processing','sent','failed','cancelled'));
UPDATE meta_conversion_events SET status = 'cancelled', updated_at = NOW()
 WHERE crm_stage IS NOT NULL AND status IN ('pending','processing','failed');
