-- The archive flag owns current cold state after 0128. Older stage-only cold
-- events remain valid history, but cannot keep an unarchived lead cold forever.
-- Record the policy cutover without impersonating a restoration or earning a
-- reactivation bonus: frozen lead/trial facts and reactivated_at stay unchanged.
ALTER TABLE academy_sales_kpi_activity
 DROP CONSTRAINT academy_sales_kpi_activity_kind_check;
ALTER TABLE academy_sales_kpi_activity
 ADD CONSTRAINT academy_sales_kpi_activity_kind_check
 CHECK(kind IN ('contact', 'cold', 'reactivated', 'cold_reset'));
--> statement-breakpoint
WITH cutover AS (SELECT timezone('UTC', now()) AS occurred_at)
INSERT INTO academy_sales_kpi_activity(lead_id, kind, source_key, occurred_at)
SELECT lead.id, 'cold_reset', 'archive-policy-reset:' || lead.id, cutover.occurred_at
FROM academy_leads lead
JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = lead.id
CROSS JOIN cutover
JOIN LATERAL (
 SELECT activity.kind
 FROM academy_sales_kpi_activity activity
 WHERE activity.lead_id = lead.id
   AND activity.kind IN ('cold', 'reactivated', 'cold_reset')
   AND activity.occurred_at <= cutover.occurred_at
 ORDER BY activity.occurred_at DESC, activity.id DESC
 LIMIT 1
) latest ON latest.kind = 'cold'
WHERE COALESCE(lead.is_archived, false) = false
ON CONFLICT DO NOTHING;
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
      WHERE lead_id = lead.id AND kind IN ('cold', 'reactivated', 'cold_reset'))
    ON CONFLICT DO NOTHING;
  END IF;
  UPDATE academy_sales_kpi_trials trial SET closer_id = tracked.closer_id
  FROM academy_demo_lesson_participants participant, academy_students student, academy_sales_kpi_leads tracked
  WHERE trial.participant_id = participant.id AND participant.student_id = student.id
    AND student.lead_id = p_lead AND tracked.lead_id = p_lead
    AND trial.closer_id IS NULL AND tracked.closer_id IS NOT NULL;
END
$$;
