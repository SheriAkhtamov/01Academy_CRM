-- Current-schema check: apply all registered migrations first. Test data rolls back.
-- Qualification is written by the explicit manual-move application handler;
-- scripts/verify-sales-workflow.ts verifies that handler and cross-funnel deduplication.
-- psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f tests/sql/demo-lead-workflow.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  employee_key integer; peer_key integer; extra_module_employee integer; funnel_a integer; funnel_b integer;
  intake_a text := 'verify_a_' || txid_current(); intake_b text := 'verify_b_' || txid_current();
  ordinary_a text := 'verify_next_' || txid_current(); source_key integer; course_key integer;
  school_key integer; teacher_key integer; lead_key integer; student_key integer;
  sibling_key integer; demo_key integer; participant_key integer; sibling_participant integer; task_key integer;
  month_key text := to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'); rejected boolean;
  first_intake_owner integer; second_intake_owner integer; ordinary_owner integer;
BEGIN
  IF current_database() NOT LIKE '%\_test' ESCAPE '\' AND current_database() NOT LIKE 'crm_demo_workflow_test_%' THEN
    RAISE EXCEPTION 'Use a disposable workflow test database';
  END IF;
  ASSERT to_regclass('academy_lead_funnel_qualifications') IS NOT NULL, 'Apply migration 0128 first';
  INSERT INTO users(email,password,full_name,module) VALUES
    ('workflow-' || txid_current() || '@example.test','disabled-test-hash','Two-funnel employee','sales') RETURNING id INTO employee_key;
  INSERT INTO users(email,password,full_name,module) VALUES
    ('workflow-peer-' || txid_current() || '@example.test','disabled-test-hash','Unassigned peer','sales') RETURNING id INTO peer_key;
  INSERT INTO academy_sales_kpi_assignments(user_id,effective_month,role,created_at)
    VALUES(employee_key,month_key,'hunter',now() - interval '1 day');
  INSERT INTO academy_sales_funnels(name) VALUES ('Workflow A ' || txid_current()) RETURNING id INTO funnel_a;
  INSERT INTO academy_sales_funnels(name) VALUES ('Workflow B ' || txid_current()) RETURNING id INTO funnel_b;
  INSERT INTO academy_lead_statuses(code,name,color,sort_order,funnel_id,is_pipeline) VALUES
    (intake_a,'Intake A','#112233',0,funnel_a,true),(ordinary_a,'Any label','#445566',10,funnel_a,true),
    (intake_b,'Intake B','#112233',0,funnel_b,true);
  UPDATE academy_sales_funnels SET initial_stage_code = intake_a WHERE id = funnel_a;
  UPDATE academy_sales_funnels SET initial_stage_code = intake_b WHERE id = funnel_b;
  INSERT INTO academy_sales_funnel_users(user_id,funnel_id) VALUES(employee_key,funnel_a),(employee_key,funnel_b);
  INSERT INTO academy_lead_sources(code,name) VALUES('workflow_' || txid_current(),'Test source') RETURNING id INTO source_key;
  INSERT INTO academy_courses(name,slug,age_category) VALUES('Test course','workflow-' || txid_current(),'kids') RETURNING id INTO course_key;
  INSERT INTO academy_schools(name,code,address) VALUES('Test school','WF' || txid_current(),'Test') RETURNING id INTO school_key;
  INSERT INTO academy_teachers(full_name) VALUES('Test teacher') RETURNING id INTO teacher_key;
  INSERT INTO academy_leads(contact_name,phone,source_id,funnel_id,status_code,manager_id)
    VALUES('Test parent','workflow-' || txid_current(),source_key,funnel_a,intake_a,employee_key) RETURNING id INTO lead_key;
  INSERT INTO academy_students(contact_name,student_name,lead_id,course_id,manager_id,referral_code)
    VALUES('Test parent','Student',lead_key,course_key,employee_key,'workflow-' || txid_current()) RETURNING id INTO student_key;
  INSERT INTO academy_students(contact_name,student_name,lead_id,course_id,manager_id,referral_code)
    VALUES('Test parent','Sibling',lead_key,course_key,employee_key,'workflow-sibling-' || txid_current()) RETURNING id INTO sibling_key;
  INSERT INTO academy_tasks(title,entity_type,entity_id,responsible_id)
    VALUES('Follow up','lead',lead_key,employee_key) RETURNING id INTO task_key;
  INSERT INTO academy_demo_lessons(course_id,school_id,teacher_id,scheduled_at,format)
    VALUES(course_key,school_key,teacher_key,timezone('UTC',now()) - interval '1 hour','online') RETURNING id INTO demo_key;
  INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id)
    VALUES(demo_key,student_key) RETURNING id INTO participant_key;
  INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id)
    VALUES(demo_key,sibling_key) RETURNING id INTO sibling_participant;

  UPDATE academy_demo_lesson_participants SET status = 'attended' WHERE id = participant_key;
  UPDATE academy_demo_lesson_participants SET status = 'no_show', no_show_reason_code = 'forgot' WHERE id = sibling_participant;
  UPDATE academy_demo_lesson_participants SET status = 'attended' WHERE id = participant_key;
  ASSERT (SELECT status_code = intake_a AND funnel_id = funnel_a AND manager_id = employee_key FROM academy_leads WHERE id = lead_key),
    'Attendance, no-show and retry must preserve the chosen stage/funnel/owner';
  ASSERT (SELECT responsible_id = employee_key FROM academy_tasks WHERE id = task_key), 'Attendance must keep the task executor';
  ASSERT (SELECT bool_and(manager_id = employee_key) FROM academy_students WHERE lead_id = lead_key), 'Attendance must keep student owners';
  ASSERT (SELECT count(*) = 2 FROM academy_sales_kpi_trials WHERE participant_id IN (participant_key,sibling_participant)),
    'Bookings remain actual participant facts';
  ASSERT NOT EXISTS(SELECT 1 FROM academy_lead_stage_history WHERE lead_id = lead_key), 'Attendance must not fabricate a manual stage move';
  ASSERT NOT EXISTS(SELECT 1 FROM academy_lead_funnel_qualifications WHERE lead_id = lead_key), 'Automatic facts must not qualify intake';

  INSERT INTO academy_payments(lead_id,student_id,amount_uzs,status,paid_at)
    VALUES(lead_key,student_key,100000,'paid',timezone('UTC',now()));
  ASSERT (SELECT status_code = intake_a AND funnel_id = funnel_a AND manager_id = employee_key FROM academy_leads WHERE id = lead_key),
    'Payment must preserve the selected stage/funnel/owner';
  UPDATE academy_leads SET status_code = ordinary_a WHERE id = lead_key;
  ASSERT NOT EXISTS(SELECT 1 FROM academy_lead_funnel_qualifications WHERE lead_id = lead_key),
    'Bare SQL/integration moves cannot invent a manual qualification';
  UPDATE academy_leads SET funnel_id = funnel_b, status_code = intake_b WHERE id = lead_key;
  UPDATE academy_leads SET is_archived = true WHERE id = lead_key;
  ASSERT NOT EXISTS(SELECT 1 FROM academy_lead_funnel_qualifications WHERE lead_id = lead_key),
    'Transfer and archive on the destination intake must not qualify';
  ASSERT (SELECT count(*) = 2 FROM academy_sales_funnel_users WHERE user_id = employee_key), 'Both selected funnel memberships remain';
  rejected := false;
  BEGIN UPDATE academy_leads SET manager_id = peer_key WHERE id = lead_key;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'salesFunnelNotAssigned' THEN RAISE; END IF;
    rejected := true;
  END;
  ASSERT rejected, 'An unselected funnel cannot be assigned to an employee';
  rejected := false;
  BEGIN UPDATE academy_leads SET status_code = ordinary_a WHERE id = lead_key;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'salesFunnelStageUnavailable' THEN RAISE; END IF;
    rejected := true;
  END;
  ASSERT rejected, 'The destination must use a stage owned by its own funnel';
  -- Distribution follows explicit intake metadata and the selected sales roster,
  -- including an employee whose sales access is an additional module with no KPI plan.
  INSERT INTO users(email,password,full_name,module) VALUES
    ('workflow-extra-' || txid_current() || '@example.test','disabled-test-hash','Extra sales access','finance')
    RETURNING id INTO extra_module_employee;
  INSERT INTO user_modules(user_id,module) VALUES(extra_module_employee,'sales');
  INSERT INTO academy_sales_funnel_users(user_id,funnel_id) VALUES(extra_module_employee,funnel_a);
  UPDATE academy_sales_funnels SET is_default = false WHERE is_default;
  UPDATE academy_sales_funnels SET is_default = true WHERE id = funnel_a;
  UPDATE academy_company_settings SET auto_lead_distribution_enabled = true, auto_lead_distribution_cursor = 0;
  UPDATE academy_lead_statuses SET name = 'Renamed first stage' WHERE code = intake_a;
  INSERT INTO academy_leads(contact_name,phone,source_id,funnel_id,status_code)
    VALUES('First intake','first-' || txid_current(),source_key,funnel_a,intake_a) RETURNING manager_id INTO first_intake_owner;
  INSERT INTO academy_leads(contact_name,phone,source_id,funnel_id,status_code)
    VALUES('Second intake','second-' || txid_current(),source_key,funnel_a,intake_a) RETURNING manager_id INTO second_intake_owner;
  ASSERT first_intake_owner IS NOT NULL AND second_intake_owner IS NOT NULL
    AND first_intake_owner <> second_intake_owner
    AND first_intake_owner IN(employee_key,extra_module_employee) AND second_intake_owner IN(employee_key,extra_module_employee),
    'Explicit intake must distribute across both selected sales employees regardless of primary module or KPI role';
  INSERT INTO academy_leads(contact_name,phone,source_id,funnel_id,status_code)
    VALUES('Ordinary label','ordinary-' || txid_current(),source_key,funnel_a,ordinary_a) RETURNING manager_id INTO ordinary_owner;
  ASSERT ordinary_owner IS NULL, 'Ordinary stages must not trigger automatic intake distribution';
  ASSERT NOT EXISTS(SELECT 1 FROM academy_lead_funnel_qualifications WHERE lead_id = lead_key),
    'Intake distribution cannot change the original unqualified lead';
  RAISE NOTICE 'PASS: demo and payment facts keep ownership/stages; transfer and archive do not qualify; both selected funnels remain available';
END $$;
ROLLBACK;
