-- Continuing work on a lead preserves its existing owner. Role restrictions
-- still apply to new assignments and cannot be bypassed to take another lead.
CREATE OR REPLACE FUNCTION protect_sales_workflow_lead() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text; assigned_role text; retains_owner boolean := false;
BEGIN
  SELECT workflow_role INTO phase FROM academy_sales_funnels WHERE id = NEW.funnel_id;
  IF phase IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR NEW.status_code IS DISTINCT FROM OLD.status_code
    OR NEW.funnel_id IS DISTINCT FROM OLD.funnel_id THEN
    IF NEW.status_code <> 'not_now' AND academy_sales_stage_role(NEW.status_code) IS DISTINCT FROM phase THEN
      RAISE EXCEPTION 'salesFunnelStageUnavailable';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    retains_owner := NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id
      AND NEW.funnel_id IS DISTINCT FROM OLD.funnel_id
      AND (phase = 'closer' AND NEW.status_code = 'demo_attended'
        OR phase = 'hunter' AND NEW.status_code IN ('demo_invited', 'ne_prishli_na_vstrechu'));
  END IF;
  IF NEW.manager_id IS NOT NULL AND NOT retains_owner
    AND (TG_OP = 'INSERT' OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
      OR NEW.funnel_id IS DISTINCT FROM OLD.funnel_id) THEN
    assigned_role := academy_kpi_employee_role(NEW.manager_id);
    IF phase = 'closer' AND assigned_role IS DISTINCT FROM 'closer'
      AND assigned_role IS DISTINCT FROM 'full_cycle'
      AND assigned_role IS DISTINCT FROM 'full_cycle_3500' THEN RAISE EXCEPTION 'salesFunnelCloserOnly'; END IF;
    IF phase = 'hunter' AND assigned_role = 'closer' THEN RAISE EXCEPTION 'salesFunnelHunterOnly'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_sales_funnel_user_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Continuing an already-owned lead does not grant access to other leads in
  -- the destination funnel. New assignments still require explicit membership.
  IF TG_OP = 'UPDATE' AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id
    AND NEW.funnel_id IS NOT DISTINCT FROM OLD.funnel_id THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id
    AND NEW.funnel_id IS DISTINCT FROM OLD.funnel_id
    AND EXISTS (SELECT 1 FROM academy_sales_funnels WHERE id = NEW.funnel_id
      AND (workflow_role = 'closer' AND NEW.status_code = 'demo_attended'
        OR (workflow_role = 'hunter' OR workflow_role IS NULL)
          AND NEW.status_code IN ('demo_invited', 'ne_prishli_na_vstrechu'))) THEN RETURN NEW; END IF;
  IF NEW.manager_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM academy_sales_funnel_users
    WHERE user_id = NEW.manager_id AND funnel_id = NEW.funnel_id
  ) THEN RAISE EXCEPTION 'salesFunnelNotAssigned'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Called within the attendance/continuation transaction, after the parent lead
-- is locked and participant marks are saved. Historical backfill uses it too.
CREATE OR REPLACE FUNCTION academy_transition_demo_lead(
  p_lead_id integer, p_status_code text, p_demo_attended boolean,
  p_demo_lesson_id integer, p_changed_by integer, p_comment text
) RETURNS academy_leads LANGUAGE plpgsql AS $$
DECLARE
  lead academy_leads%ROWTYPE;
  updated academy_leads%ROWTYPE;
  current_phase text;
  target_status text := p_status_code;
  target_funnel integer;
  source_funnel integer;
BEGIN
  SELECT * INTO lead FROM academy_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'resourceNotFound'; END IF;
  IF lead.is_archived THEN RAISE EXCEPTION 'accessDenied'; END IF;
  IF p_status_code NOT IN ('demo_attended', 'ne_prishli_na_vstrechu', 'demo_invited')
    OR NOT EXISTS (SELECT 1 FROM academy_lead_statuses
      WHERE code = p_status_code AND is_active AND is_pipeline) THEN
    RAISE EXCEPTION 'invalidLeadStatus';
  END IF;
  SELECT workflow_role INTO current_phase FROM academy_sales_funnels WHERE id = lead.funnel_id;
  -- Attendance corrections must never undo subsequent closer work, including
  -- custom stages. The manual command is separately guarded by the application.
  IF p_demo_lesson_id IS NOT NULL AND current_phase = 'closer'
    AND lead.status_code <> 'demo_attended' THEN RETURN lead; END IF;
  target_funnel := lead.funnel_id;
  -- A manual continuation remains valid when a later pending booking is added
  -- or reset. Only an actual no-show result returns that lead to the main funnel.
  IF p_status_code = 'demo_invited' AND current_phase = 'closer'
    AND EXISTS (SELECT 1 FROM academy_lead_funnel_handoffs
      WHERE lead_id = lead.id AND demo_lesson_id IS NULL AND returned_at IS NULL) THEN
    target_status := lead.status_code;
  END IF;
  IF target_status = 'demo_attended' THEN
    SELECT id INTO target_funnel FROM academy_sales_funnels
      WHERE workflow_role = 'closer' AND is_active FOR SHARE;
  ELSIF current_phase = 'closer' THEN
    SELECT funnel.id INTO target_funnel
      FROM academy_lead_funnel_handoffs handoff
      JOIN academy_sales_funnels funnel ON funnel.id = handoff.from_funnel_id
      WHERE handoff.lead_id = lead.id AND funnel.is_active
        AND (funnel.workflow_role = 'hunter' OR funnel.workflow_role IS NULL) FOR SHARE OF funnel;
    IF target_funnel IS NULL THEN
      SELECT id INTO target_funnel FROM academy_sales_funnels
        WHERE workflow_role = 'hunter' AND is_active FOR SHARE;
    END IF;
  END IF;
  IF target_funnel IS NULL THEN RAISE EXCEPTION 'salesFunnelRequired'; END IF;
  IF lead.status_code = target_status AND lead.funnel_id = target_funnel
    AND (p_demo_attended IS NULL OR lead.demo_attended = p_demo_attended) THEN RETURN lead; END IF;

  IF lead.funnel_id IS DISTINCT FROM target_funnel THEN
    IF target_status = 'demo_attended' THEN
      PERFORM academy_kpi_touch_lead(lead.id);
      source_funnel := lead.funnel_id;
      IF source_funnel IS NULL THEN
        SELECT id INTO source_funnel FROM academy_sales_funnels WHERE workflow_role = 'hunter';
      END IF;
      INSERT INTO academy_lead_funnel_handoffs(lead_id, from_funnel_id, from_manager_id, demo_lesson_id)
        VALUES (lead.id, source_funnel, lead.manager_id, p_demo_lesson_id)
        ON CONFLICT (lead_id) DO UPDATE SET from_funnel_id = EXCLUDED.from_funnel_id,
          from_manager_id = EXCLUDED.from_manager_id, demo_lesson_id = EXCLUDED.demo_lesson_id,
          handed_off_at = timezone('UTC', now()), returned_at = NULL;
    ELSE
      UPDATE academy_lead_funnel_handoffs SET returned_at = timezone('UTC', now()) WHERE lead_id = lead.id;
    END IF;
  END IF;
  -- manager_id, student owners and task owners deliberately remain untouched.
  UPDATE academy_leads SET status_code = target_status, funnel_id = target_funnel,
    demo_attended = COALESCE(p_demo_attended, lead.demo_attended),
    first_viewed_at = CASE WHEN lead.funnel_id IS DISTINCT FROM target_funnel THEN NULL ELSE first_viewed_at END,
    first_viewed_by = CASE WHEN lead.funnel_id IS DISTINCT FROM target_funnel THEN NULL ELSE first_viewed_by END,
    updated_at = timezone('UTC', now()) WHERE id = lead.id RETURNING * INTO updated;
  IF lead.status_code IS DISTINCT FROM updated.status_code OR lead.funnel_id IS DISTINCT FROM updated.funnel_id THEN
    INSERT INTO academy_lead_stage_history(lead_id, from_status_code, to_status_code, changed_by, comment)
      VALUES (lead.id, lead.status_code, updated.status_code, p_changed_by, p_comment);
  END IF;
  IF p_changed_by IS NULL THEN
    INSERT INTO audit_logs(action, entity_type, entity_id, old_values, new_values)
      VALUES ('MIGRATE_DEMO_LEAD_WORKFLOW', 'academy_lead', lead.id,
        jsonb_build_object('statusCode', lead.status_code, 'funnelId', lead.funnel_id,
          'managerId', lead.manager_id, 'demoAttended', lead.demo_attended),
        jsonb_build_object('statusCode', updated.status_code, 'funnelId', updated.funnel_id,
          'managerId', updated.manager_id, 'demoAttended', updated.demo_attended, 'demoLessonId', p_demo_lesson_id));
  END IF;
  RETURN updated;
END $$;
--> statement-breakpoint
-- Correct only active leads still in the demo part of the workflow. Never
-- regress later sales stages, manufacture attendance or replace current owners.
DO $$
DECLARE lead record; latest record;
BEGIN
  FOR lead IN SELECT parent.id FROM academy_leads parent
    LEFT JOIN academy_sales_funnels funnel ON funnel.id = parent.funnel_id
    WHERE NOT parent.is_archived AND parent.status_code NOT IN ('offer', 'thinking', 'enrolled', 'paid', 'not_now')
      AND (funnel.workflow_role IS DISTINCT FROM 'closer' OR parent.status_code = 'demo_attended')
    ORDER BY parent.id FOR UPDATE OF parent LOOP
    SELECT demo.id, CASE WHEN bool_or(participant.status = 'attended' AND demo.status <> 'not_conducted')
      THEN 'demo_attended' ELSE 'ne_prishli_na_vstrechu' END AS result INTO latest
      FROM academy_demo_lessons demo
      JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
      JOIN academy_students student ON student.id = participant.student_id
      WHERE student.lead_id = lead.id AND demo.status IN ('scheduled', 'completed', 'not_conducted')
        AND participant.status <> 'cancelled'
      GROUP BY demo.id, demo.scheduled_at
      HAVING bool_or(participant.status = 'no_show'
        OR participant.status = 'attended' AND demo.status <> 'not_conducted')
      ORDER BY demo.scheduled_at DESC, demo.id DESC LIMIT 1;
    IF FOUND THEN
      PERFORM academy_transition_demo_lead(lead.id, latest.result, latest.result = 'demo_attended',
        latest.id, NULL, 'Обновление этапа по сохранённой посещаемости учеников на демо');
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- The accounting unit remains a participant/student, never an aggregate lead
-- flag. Fill missing tracked bookings only within the existing tracking window.
SELECT academy_kpi_touch_lead(student.lead_id)
FROM (SELECT DISTINCT student.lead_id FROM academy_students student
  JOIN academy_demo_lesson_participants participant ON participant.student_id = student.id
  WHERE participant.status IN ('invited', 'confirmed', 'attended', 'no_show')) student;
INSERT INTO academy_sales_kpi_trials(participant_id, hunter_id, closer_id, booked_at, reactivated)
SELECT participant.id, tracked.hunter_id, tracked.closer_id,
  GREATEST(participant.created_at, tracked.tracked_at),
  COALESCE(tracked.reactivated_at IS NOT NULL
    AND tracked.reactivated_at <= GREATEST(participant.created_at, tracked.tracked_at), false)
FROM academy_demo_lesson_participants participant
JOIN academy_students student ON student.id = participant.student_id
JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = student.lead_id
JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
WHERE participant.status IN ('invited', 'confirmed', 'attended', 'no_show')
  AND (participant.created_at >= tracked.tracked_at OR demo.scheduled_at >= tracked.tracked_at)
ON CONFLICT (participant_id) DO NOTHING;
