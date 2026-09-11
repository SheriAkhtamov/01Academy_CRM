-- A demo scheduled after KPI tracking begins is part of the tracked cohort even
-- when the invitation itself was created earlier. Keep the frozen lead owners
-- and clamp the booking timestamp to the tracking boundary so pre-launch work
-- is not reported as a new event before KPI tracking existed.
CREATE OR REPLACE FUNCTION academy_kpi_capture_trial() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_lead integer;
  scheduled_at timestamp;
  booked_at timestamp;
  tracked academy_sales_kpi_leads%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('invited', 'confirmed', 'attended', 'no_show') THEN RETURN NEW; END IF;
  SELECT lead_id INTO linked_lead FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  SELECT * INTO tracked FROM academy_sales_kpi_leads WHERE lead_id = linked_lead;
  SELECT demo.scheduled_at INTO scheduled_at FROM academy_demo_lessons demo WHERE demo.id = NEW.demo_lesson_id;
  IF tracked.lead_id IS NULL
    OR (NEW.created_at < tracked.tracked_at AND (scheduled_at IS NULL OR scheduled_at < tracked.tracked_at))
  THEN RETURN NEW; END IF;
  booked_at := GREATEST(NEW.created_at, tracked.tracked_at);
  INSERT INTO academy_sales_kpi_trials(participant_id, hunter_id, closer_id, booked_at, reactivated)
  VALUES (NEW.id, tracked.hunter_id, tracked.closer_id, booked_at,
    COALESCE(tracked.reactivated_at IS NOT NULL AND tracked.reactivated_at <= booked_at, false))
  ON CONFLICT (participant_id) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Backfill only demos whose scheduled occurrence belongs to the tracked
-- period. Existing KPI facts and their frozen owners are never overwritten.
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
  AND participant.created_at < tracked.tracked_at
  AND demo.scheduled_at >= tracked.tracked_at
ON CONFLICT (participant_id) DO NOTHING;
