ALTER TABLE academy_sales_kpi_plans
  DROP CONSTRAINT IF EXISTS academy_sales_kpi_plans_role_check;
ALTER TABLE academy_sales_kpi_plans
  ADD CONSTRAINT academy_sales_kpi_plans_role_check
  CHECK (role IN ('hunter', 'closer', 'full_cycle'));
ALTER TABLE academy_sales_kpi_assignments
  DROP CONSTRAINT IF EXISTS academy_sales_kpi_assignments_role_check;
ALTER TABLE academy_sales_kpi_assignments
  ADD CONSTRAINT academy_sales_kpi_assignments_role_check
  CHECK (role IN ('hunter', 'closer', 'full_cycle'));
--> statement-breakpoint
-- Full-cycle ownership freezes the same employee in both KPI phases. Existing
-- hunter and closer facts retain their original owners.
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
  VALUES (lead.id, CASE WHEN assigned_role IN ('hunter', 'full_cycle') THEN lead.manager_id END,
    CASE WHEN assigned_role IN ('closer', 'full_cycle') THEN lead.manager_id END, lead.created_at, tracking_start)
  ON CONFLICT (lead_id) DO UPDATE SET
    hunter_id = COALESCE(academy_sales_kpi_leads.hunter_id, EXCLUDED.hunter_id),
    closer_id = COALESCE(academy_sales_kpi_leads.closer_id, EXCLUDED.closer_id);
  IF lead.status_code = 'not_now' OR lead.is_archived THEN
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
CREATE OR REPLACE FUNCTION protect_sales_workflow_lead() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.manager_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
    OR NEW.funnel_id IS DISTINCT FROM OLD.funnel_id) THEN
    assigned_role := academy_kpi_employee_role(NEW.manager_id);
    IF phase = 'closer' AND assigned_role IS DISTINCT FROM 'closer' AND assigned_role IS DISTINCT FROM 'full_cycle' THEN RAISE EXCEPTION 'salesFunnelCloserOnly'; END IF;
    IF phase = 'hunter' AND assigned_role = 'closer' THEN RAISE EXCEPTION 'salesFunnelHunterOnly'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_kpi_capture_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_lead integer;
  assigned_manager integer;
  attributed_closer integer;
  sale_kind text;
  prior_sale boolean;
BEGIN
  IF NEW.status <> 'paid' OR NEW.amount_uzs <= 0 OR NEW.student_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM academy_sales_kpi_sales WHERE payment_id = NEW.id) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('paid', 'refunded') THEN RETURN NEW; END IF;
  PERFORM 1 FROM academy_students WHERE id = NEW.student_id FOR UPDATE;
  SELECT COALESCE(NEW.lead_id, lead_id), manager_id INTO linked_lead, assigned_manager
    FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  SELECT closer_id INTO attributed_closer FROM academy_sales_kpi_leads WHERE lead_id = linked_lead;
  IF attributed_closer IS NULL AND academy_kpi_employee_role(assigned_manager) IN ('closer', 'full_cycle') THEN
    attributed_closer := assigned_manager;
  END IF;
  SELECT EXISTS (SELECT 1 FROM academy_payments payment
    WHERE payment.student_id = NEW.student_id AND payment.id <> NEW.id
      AND payment.amount_uzs > 0 AND payment.status IN ('paid', 'refunded')) INTO prior_sale;
  sale_kind := CASE WHEN NEW.type = 'installment_2_2' THEN 'installment'
    WHEN NOT prior_sale THEN 'new' ELSE 'unclassified' END;
  INSERT INTO academy_sales_kpi_sales (payment_id, closer_id, kind)
    VALUES (NEW.id, attributed_closer, sale_kind) ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION academy_kpi_capture_survey() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_lead integer; assigned_manager integer;
BEGIN
  SELECT lead_id, manager_id INTO linked_lead, assigned_manager FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  INSERT INTO academy_sales_kpi_surveys (survey_id, closer_id)
    VALUES (NEW.id, COALESCE((SELECT closer_id FROM academy_sales_kpi_leads WHERE lead_id = linked_lead),
      CASE WHEN academy_kpi_employee_role(assigned_manager) IN ('closer', 'full_cycle') THEN assigned_manager END))
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Seed the new system from the currently effective hunter and closer rules.
-- The original plan rows and their version history are not changed.
INSERT INTO academy_sales_kpi_plans (role, effective_month, config)
SELECT 'full_cycle', to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'),
  jsonb_build_object('hunter', hunter.config, 'closer', closer.config)
FROM LATERAL (
  SELECT config FROM academy_sales_kpi_plans
  WHERE role = 'hunter' AND effective_month <= to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
  ORDER BY effective_month DESC, id DESC LIMIT 1
) hunter
CROSS JOIN LATERAL (
  SELECT config FROM academy_sales_kpi_plans
  WHERE role = 'closer' AND effective_month <= to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
  ORDER BY effective_month DESC, id DESC LIMIT 1
) closer;
