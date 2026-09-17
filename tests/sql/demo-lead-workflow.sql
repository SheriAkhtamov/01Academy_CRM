-- Run after all migrations, only in a disposable database:
-- psql -X -v ON_ERROR_STOP=1 -d crm_demo_workflow_test_... -f tests/sql/demo-lead-workflow.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'crm_demo_workflow_test_%' THEN
    RAISE EXCEPTION 'Disposable demo workflow database required';
  END IF;
END $$;

CREATE FUNCTION pg_temp.check_result(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

INSERT INTO users(id, email, password, full_name, module) VALUES
  (90001, 'demo-hunter@example.test', 'not-a-login', 'Hunter', 'sales'),
  (90002, 'demo-full-cycle@example.test', 'not-a-login', 'Full cycle', 'sales'),
  (90003, 'demo-teacher@example.test', 'not-a-login', 'Teacher', 'teacher'),
  (90004, 'demo-admin@example.test', 'not-a-login', 'Admin', 'administration');
INSERT INTO academy_sales_kpi_assignments(user_id, effective_month, role, created_at) VALUES
  (90001, to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'), 'hunter', now() - interval '1 day'),
  (90002, to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'), 'full_cycle', now() - interval '1 day');
INSERT INTO academy_sales_funnel_users(funnel_id, user_id)
  SELECT id, 90001 FROM academy_sales_funnels WHERE workflow_role = 'hunter';
INSERT INTO academy_sales_funnel_users(funnel_id, user_id)
  SELECT id, 90002 FROM academy_sales_funnels WHERE workflow_role IN ('hunter', 'closer');
INSERT INTO academy_lead_statuses(code, name, color, sort_order) VALUES
  ('demo_invited', 'Invited', '#000000', 40), ('qualified', 'Qualified', '#000000', 30),
  ('offer', 'Offer', '#000000', 60), ('custom_closer_test', 'Custom closer', '#000000', 65)
  ON CONFLICT (code) DO NOTHING;
INSERT INTO academy_courses(id, name, slug, age_category) VALUES (90001, 'Demo test', 'demo-test', 'kids');
INSERT INTO academy_schools(id, name, code, address) VALUES (90001, 'Test office', 'TEST', 'Test');
INSERT INTO academy_teachers(id, full_name, user_id) VALUES (90001, 'Test teacher', 90003);
INSERT INTO academy_demo_lessons(id, course_id, school_id, teacher_id, scheduled_at, format)
  VALUES (90001, 90001, 90001, 90001, now() - interval '1 hour', 'online');
INSERT INTO academy_leads(id, contact_name, source_id, funnel_id, status_code, manager_id, is_archived)
SELECT 90000 + n, 'Demo lead ' || n, (SELECT min(id) FROM academy_lead_sources),
  (SELECT id FROM academy_sales_funnels WHERE workflow_role = CASE WHEN n = 8 THEN 'closer' ELSE 'hunter' END),
  CASE WHEN n = 8 THEN 'offer' ELSE 'demo_invited' END,
  CASE WHEN n = 5 THEN NULL WHEN n IN (6,7,8,9) THEN 90002 ELSE 90001 END, n = 9
FROM generate_series(1,9) n;
INSERT INTO academy_students(id, contact_name, student_name, referral_code, lead_id, course_id, manager_id)
SELECT 91000 + n * 2 + sibling, 'Parent ' || n, 'Student ' || n || '/' || sibling,
  'demo-test-' || n || '-' || sibling, 90000 + n, 90001,
  CASE WHEN n = 5 THEN NULL WHEN n IN (6,7,8,9) THEN 90002 ELSE 90001 END
FROM generate_series(1,9) n CROSS JOIN generate_series(0,1) sibling;
INSERT INTO academy_demo_lesson_participants(id, demo_lesson_id, student_id)
  SELECT id, 90001, id FROM academy_students WHERE id BETWEEN 91002 AND 91019;
INSERT INTO academy_tasks(id, title, entity_type, entity_id, responsible_id)
  VALUES (90001, 'Test task', 'lead', 90001, 90001);

DO $$ DECLARE moved academy_leads; history_count integer; BEGIN
  -- One attended sibling is sufficient; the other student stays unmarked.
  UPDATE academy_demo_lesson_participants SET status = 'attended' WHERE id = 91002;
  SELECT * INTO moved FROM academy_transition_demo_lead(90001, 'demo_attended', true, 90001, 90003, 'Teacher mark');
  PERFORM pg_temp.check_result(moved.status_code = 'demo_attended' AND moved.manager_id = 90001
    AND moved.funnel_id = (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'closer'), 'Attendance handoff lost owner');
  PERFORM pg_temp.check_result((SELECT status = 'invited' FROM academy_demo_lesson_participants WHERE id = 91003), 'Sibling attendance was fabricated');
  PERFORM pg_temp.check_result((SELECT count(*) = 2 FROM academy_sales_kpi_trials trial
    JOIN academy_demo_lesson_participants participant ON participant.id = trial.participant_id
    JOIN academy_students student ON student.id = participant.student_id WHERE student.lead_id = 90001), 'Bookings must count both students');
  PERFORM pg_temp.check_result((SELECT count(*) = 1 FROM academy_sales_kpi_trials trial
    JOIN academy_demo_lesson_participants participant ON participant.id = trial.participant_id
    JOIN academy_students student ON student.id = participant.student_id
    WHERE student.lead_id = 90001 AND participant.status = 'attended'), 'Attendance must count only the attending student');
  SELECT count(*) INTO history_count FROM academy_lead_stage_history WHERE lead_id = 90001;
  UPDATE academy_demo_lesson_participants SET status = 'no_show', no_show_reason_code = 'forgot' WHERE id = 91003;
  PERFORM academy_transition_demo_lead(90001, 'demo_attended', true, 90001, 90003, 'Mixed marks');
  PERFORM academy_transition_demo_lead(90001, 'demo_attended', true, 90001, 90003, 'Repeated marks');
  PERFORM pg_temp.check_result((SELECT count(*) = history_count FROM academy_lead_stage_history WHERE lead_id = 90001), 'Repeated/mixed marks duplicated history');
  -- A flag-only correction for a retained hunter needs no closer membership.
  UPDATE academy_leads SET demo_attended = false WHERE id = 90001;
  PERFORM academy_transition_demo_lead(90001, 'demo_attended', true, 90001, 90003, 'Flag correction');
  PERFORM pg_temp.check_result((SELECT demo_attended AND manager_id = 90001 FROM academy_leads WHERE id = 90001), 'Flag correction requires new assignment');
  PERFORM pg_temp.check_result((SELECT responsible_id = 90001 FROM academy_tasks WHERE id = 90001)
    AND (SELECT bool_and(manager_id = 90001) FROM academy_students WHERE lead_id = 90001), 'Child owners changed');

  -- Reverse order: a single no-show moves immediately, attendance wins later.
  UPDATE academy_demo_lesson_participants SET status = 'no_show', no_show_reason_code = 'forgot' WHERE id = 91004;
  PERFORM academy_transition_demo_lead(90002, 'ne_prishli_na_vstrechu', false, 90001, 90003, 'Absent first');
  PERFORM pg_temp.check_result((SELECT status_code = 'ne_prishli_na_vstrechu' AND manager_id = 90001
    AND funnel_id = (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'hunter') FROM academy_leads WHERE id = 90002), 'Single no-show waited for sibling');
  UPDATE academy_demo_lesson_participants SET status = 'attended' WHERE id = 91005;
  PERFORM academy_transition_demo_lead(90002, 'demo_attended', true, 90001, 90003, 'Attended second');
  PERFORM pg_temp.check_result((SELECT status_code = 'demo_attended' AND manager_id = 90001 FROM academy_leads WHERE id = 90002), 'Attendance priority lost in reverse order');

  -- Correcting the only attendee returns to the original funnel, same owner.
  UPDATE academy_demo_lesson_participants SET status = 'no_show', no_show_reason_code = 'forgot' WHERE id = 91005;
  PERFORM academy_transition_demo_lead(90002, 'ne_prishli_na_vstrechu', false, 90001, 90003, 'Correction');
  PERFORM pg_temp.check_result((SELECT status_code = 'ne_prishli_na_vstrechu' AND manager_id = 90001
    AND NOT demo_attended AND funnel_id = (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'hunter')
    FROM academy_leads WHERE id = 90002), 'Correction lost owner or original funnel');

  -- Admin continuation is not reassignment and does not invent attendance.
  PERFORM academy_transition_demo_lead(90003, 'demo_attended', NULL, NULL, 90004, 'Manual continuation');
  PERFORM academy_transition_demo_lead(90003, 'demo_invited', false, 90001, 90003, 'Pending booking');
  PERFORM pg_temp.check_result((SELECT status_code = 'demo_attended' AND manager_id = 90001 AND NOT demo_attended
    FROM academy_leads WHERE id = 90003), 'Pending booking undid manual continuation');
  PERFORM pg_temp.check_result((SELECT bool_and(status = 'invited') FROM academy_demo_lesson_participants
    WHERE student_id IN (91006,91007)), 'Manual continuation fabricated attendance');

  -- Transaction failure rolls back both the participant and lead.
  BEGIN
    UPDATE academy_demo_lesson_participants SET status = 'attended' WHERE id = 91008;
    PERFORM academy_transition_demo_lead(90004, 'demo_attended', true, 90001, -1, 'Invalid history author');
    RAISE EXCEPTION 'Expected history FK failure';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  PERFORM pg_temp.check_result((SELECT status = 'invited' FROM academy_demo_lesson_participants WHERE id = 91008)
    AND (SELECT status_code = 'demo_invited' FROM academy_leads WHERE id = 90004), 'Attendance failure was not atomic');

  PERFORM academy_transition_demo_lead(90005, 'demo_attended', true, 90001, 90003, 'Unassigned');
  PERFORM pg_temp.check_result((SELECT manager_id IS NULL FROM academy_leads WHERE id = 90005), 'Teacher took an unassigned lead');
  BEGIN
    UPDATE academy_leads SET manager_id = 90001 WHERE id = 90005;
    RAISE EXCEPTION 'Expected new assignment denial';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('salesFunnelCloserOnly', 'salesFunnelNotAssigned') THEN RAISE; END IF;
  END;
  PERFORM pg_temp.check_result((SELECT manager_id IS NULL FROM academy_leads WHERE id = 90005), 'New assignment bypassed restrictions');

  -- Later stages, including custom closer stages, are never regressed.
  UPDATE academy_leads SET status_code = 'custom_closer_test' WHERE id = 90003;
  PERFORM academy_transition_demo_lead(90003, 'ne_prishli_na_vstrechu', false, 90001, 90003, 'Late correction');
  PERFORM pg_temp.check_result((SELECT status_code = 'custom_closer_test' FROM academy_leads WHERE id = 90003), 'Custom closer stage regressed');
END $$;

-- Historical fixtures include partial attendance and a partially marked no-show.
UPDATE academy_demo_lesson_participants SET status = 'attended' WHERE id IN (91012,91016,91018);
UPDATE academy_demo_lesson_participants SET status = 'no_show', no_show_reason_code = 'forgot' WHERE id = 91014;
CREATE TEMP TABLE owner_snapshot AS SELECT id, manager_id FROM academy_leads;
CREATE TEMP TABLE participant_snapshot AS SELECT id, status FROM academy_demo_lesson_participants;
\ir ../../migrations/0115_demo_attendance_workflow.sql
SELECT pg_temp.check_result((SELECT status_code = 'demo_attended' AND manager_id = 90002
  AND funnel_id = (SELECT id FROM academy_sales_funnels WHERE workflow_role = 'closer') FROM academy_leads WHERE id = 90006), 'Backfill omitted partial attendee');
SELECT pg_temp.check_result((SELECT status_code = 'ne_prishli_na_vstrechu' AND manager_id = 90002 FROM academy_leads WHERE id = 90007), 'Backfill omitted partial no-show');
SELECT pg_temp.check_result((SELECT status_code = 'offer' FROM academy_leads WHERE id = 90008)
  AND (SELECT is_archived AND status_code = 'demo_invited' FROM academy_leads WHERE id = 90009), 'Backfill regressed later/archived lead');
SELECT pg_temp.check_result(NOT EXISTS (SELECT 1 FROM owner_snapshot saved JOIN academy_leads lead USING(id)
  WHERE saved.manager_id IS DISTINCT FROM lead.manager_id), 'Backfill changed owners');
SELECT pg_temp.check_result(NOT EXISTS (SELECT 1 FROM participant_snapshot saved JOIN academy_demo_lesson_participants participant USING(id)
  WHERE saved.status <> participant.status), 'Backfill changed student marks');
CREATE TEMP TABLE history_snapshot AS SELECT count(*) AS count FROM academy_lead_stage_history;
CREATE TEMP TABLE trials_snapshot AS SELECT count(*) AS count FROM academy_sales_kpi_trials;
\ir ../../migrations/0115_demo_attendance_workflow.sql
SELECT pg_temp.check_result((SELECT count(*) = (SELECT count FROM history_snapshot) FROM academy_lead_stage_history), 'Second backfill duplicated history');
SELECT pg_temp.check_result((SELECT count(*) = (SELECT count FROM trials_snapshot) FROM academy_sales_kpi_trials), 'Second backfill duplicated student facts');
ROLLBACK;
\echo Demo workflow SQL regression checks passed; test data rolled back.
