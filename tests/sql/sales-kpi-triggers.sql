-- Run only against a disposable restored copy after applying migration 0104.
-- psql -v ON_ERROR_STOP=1 -d crm_kpi_verify_<suffix> -f tests/sql/sales-kpi-triggers.sql
BEGIN;
DO $verify$
DECLARE
  hunter integer; closer integer; another_closer integer; lead_key integer;
  student_key integer; second_student integer; lesson_key integer; participant_key integer;
  payment_key integer; second_payment integer; renewal_payment integer;
  survey_key integer; call_key integer; conversation_key integer; message_key integer;
  course_key integer; school_key integer; teacher_key integer; lead_source_key integer; account_key integer;
  legacy_key integer; funnel_key integer;
  month_key text := to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM');
BEGIN
  IF current_database() NOT LIKE 'crm_kpi_verify_%' THEN
    RAISE EXCEPTION 'Use a disposable crm_kpi_verify_* database, never the production database';
  END IF;
  SELECT min(id) INTO course_key FROM academy_courses;
  SELECT min(id) INTO school_key FROM academy_schools;
  SELECT min(id) INTO teacher_key FROM academy_teachers;
  SELECT min(id) INTO lead_source_key FROM academy_lead_sources;
  SELECT id INTO funnel_key FROM academy_sales_funnels WHERE is_default = true LIMIT 1;
  SELECT min(id) INTO account_key FROM instagram_accounts;
  ASSERT course_key IS NOT NULL AND school_key IS NOT NULL AND teacher_key IS NOT NULL AND lead_source_key IS NOT NULL AND funnel_key IS NOT NULL,
    'The restored database needs reference records';

  INSERT INTO users (email, password, full_name, module) VALUES
    ('kpi-hunter-' || txid_current() || '@example.invalid', 'disabled-test-hash', 'KPI verification hunter', 'sales') RETURNING id INTO hunter;
  INSERT INTO users (email, password, full_name, module) VALUES
    ('kpi-closer-' || txid_current() || '@example.invalid', 'disabled-test-hash', 'KPI verification closer', 'sales') RETURNING id INTO closer;
  INSERT INTO users (email, password, full_name, module) VALUES
    ('kpi-other-' || txid_current() || '@example.invalid', 'disabled-test-hash', 'KPI verification other', 'sales') RETURNING id INTO another_closer;
  INSERT INTO academy_sales_kpi_assignments (user_id, effective_month, role)
    VALUES (hunter, month_key, 'hunter'), (closer, month_key, 'closer'), (another_closer, month_key, 'closer');
  ASSERT academy_kpi_employee_role(hunter) = 'hunter', 'Current hunter assignment';

  INSERT INTO academy_leads (contact_name, phone, student_name, student_age, source_id, funnel_id, course_id, manager_id)
    VALUES ('KPI verification', 'test-' || hunter, 'KPI verification student', 12, lead_source_key, funnel_key, course_key, hunter) RETURNING id INTO lead_key;
  ASSERT (SELECT hunter_id = hunter AND closer_id IS NULL AND qualified_at IS NOT NULL AND crm_completed_at IS NOT NULL
    FROM academy_sales_kpi_leads WHERE lead_id = lead_key), 'Lead qualification and hunter attribution';
  INSERT INTO academy_communications (lead_id, channel, result, created_by)
    VALUES (lead_key, 'call', 'KPI verification', hunter);
  ASSERT (SELECT first_response_at IS NOT NULL FROM academy_sales_kpi_leads WHERE lead_id = lead_key), 'First response capture';

  UPDATE academy_leads SET status_code = 'not_now' WHERE id = lead_key;
  UPDATE academy_leads SET status_code = 'first_contact' WHERE id = lead_key;
  ASSERT (SELECT reactivated_at IS NOT NULL FROM academy_sales_kpi_leads WHERE lead_id = lead_key), 'Reactivation capture';
  INSERT INTO academy_students (lead_id, contact_name, student_name, course_id, manager_id, referral_code)
    VALUES (lead_key, 'KPI verification', 'KPI verification student', course_key, hunter, 'kpi-verify-' || hunter) RETURNING id INTO student_key;
  INSERT INTO academy_demo_lessons (course_id, school_id, teacher_id, scheduled_at, format)
    VALUES (course_key, school_key, teacher_key, timezone('UTC', now()) - interval '2 hours', 'online') RETURNING id INTO lesson_key;
  INSERT INTO academy_demo_lesson_participants (demo_lesson_id, student_id, status)
    VALUES (lesson_key, student_key, 'confirmed') RETURNING id INTO participant_key;
  ASSERT (SELECT hunter_id = hunter AND closer_id IS NULL AND reactivated
    FROM academy_sales_kpi_trials WHERE participant_id = participant_key), 'First booking capture';

  UPDATE academy_leads SET manager_id = closer WHERE id = lead_key;
  UPDATE academy_students SET manager_id = closer WHERE id = student_key;
  ASSERT (SELECT hunter_id = hunter AND closer_id = closer FROM academy_sales_kpi_leads WHERE lead_id = lead_key), 'Lead handoff preserves hunter';
  ASSERT (SELECT hunter_id = hunter AND closer_id = closer FROM academy_sales_kpi_trials WHERE participant_id = participant_key), 'Trial receives the closer';
  UPDATE academy_demo_lesson_participants SET status = 'attended' WHERE id = participant_key;
  UPDATE academy_demo_lessons SET status = 'completed' WHERE id = lesson_key;
  UPDATE academy_leads SET offer_at = timezone('UTC', now()) WHERE id = lead_key;
  ASSERT (SELECT offer_at IS NOT NULL FROM academy_sales_kpi_leads WHERE lead_id = lead_key), 'Offer capture';

  INSERT INTO academy_payments (lead_id, student_id, amount_uzs, type, status, paid_at)
    VALUES (lead_key, student_key, 100000, 'installment_1_2', 'pending', timezone('UTC', now())) RETURNING id INTO payment_key;
  ASSERT NOT EXISTS (SELECT 1 FROM academy_sales_kpi_sales WHERE payment_id = payment_key), 'Pending payments are not achievements';
  UPDATE academy_payments SET status = 'paid' WHERE id = payment_key;
  ASSERT (SELECT kind = 'new' AND closer_id = closer FROM academy_sales_kpi_sales WHERE payment_id = payment_key), 'First installment is one new student';
  INSERT INTO academy_payments (lead_id, student_id, amount_uzs, type, status, paid_at)
    VALUES (lead_key, student_key, 100000, 'installment_2_2', 'paid', timezone('UTC', now())) RETURNING id INTO second_payment;
  ASSERT (SELECT kind = 'installment' FROM academy_sales_kpi_sales WHERE payment_id = second_payment), 'Second installment is excluded';
  INSERT INTO academy_payments (lead_id, student_id, amount_uzs, type, status, paid_at)
    VALUES (lead_key, student_key, 200000, 'full', 'paid', timezone('UTC', now())) RETURNING id INTO renewal_payment;
  ASSERT (SELECT kind = 'unclassified' FROM academy_sales_kpi_sales WHERE payment_id = renewal_payment), 'Subsequent sale requires classification';
  UPDATE academy_sales_kpi_sales SET kind = 'renewal', cycle_key = month_key WHERE payment_id = renewal_payment;

  UPDATE academy_leads SET manager_id = another_closer WHERE id = lead_key;
  UPDATE academy_payments SET comment = 'KPI verification' WHERE id = payment_key;
  ASSERT (SELECT closer_id = closer FROM academy_sales_kpi_sales WHERE payment_id = payment_key), 'Changing manager preserves sale attribution';
  ASSERT (SELECT closer_id = closer FROM academy_sales_kpi_trials WHERE participant_id = participant_key), 'Changing manager preserves trial attribution';
  UPDATE academy_payments SET status = 'refunded' WHERE id = payment_key;
  ASSERT NOT EXISTS (SELECT 1 FROM academy_sales_kpi_sales fact JOIN academy_payments payment ON payment.id = fact.payment_id
    WHERE payment.student_id = student_key AND fact.kind = 'new' AND payment.status = 'paid'), 'Refund removes the paid new-sale fact';

  INSERT INTO academy_parent_surveys (student_id, period, nps_score)
    VALUES (student_key, month_key, 10) RETURNING id INTO survey_key;
  ASSERT (SELECT closer_id = closer FROM academy_sales_kpi_surveys WHERE survey_id = survey_key), 'Survey retains original closer attribution';
  INSERT INTO telephony_calls (direction, status, phone, contact_type, contact_id, user_id)
    VALUES ('outgoing', 'dialing', 'test-' || hunter, 'student', student_key, hunter) RETURNING id INTO call_key;
  ASSERT EXISTS (SELECT 1 FROM academy_sales_kpi_activity WHERE lead_id = lead_key AND source_key = 'call:' || call_key), 'Outgoing student call is captured';
  UPDATE telephony_calls SET status = 'ended' WHERE id = call_key;
  ASSERT (SELECT count(*) = 1 FROM academy_sales_kpi_activity WHERE source_key = 'call:' || call_key), 'Call updates are idempotent';

  IF account_key IS NOT NULL THEN
    INSERT INTO instagram_conversations (account_id, lead_id, participant_igsid)
      VALUES (account_key, lead_key, 'kpi-verify-' || txid_current()) RETURNING id INTO conversation_key;
    INSERT INTO instagram_messages (conversation_id, direction, sender_igsid, recipient_igsid, content, status)
      VALUES (conversation_key, 'outbound', 'kpi-test-sender', 'kpi-test-recipient', 'KPI verification', 'pending') RETURNING id INTO message_key;
    ASSERT NOT EXISTS (SELECT 1 FROM academy_sales_kpi_activity WHERE source_key = 'instagram:' || message_key), 'Unsent message is excluded';
    UPDATE instagram_messages SET status = 'sent' WHERE id = message_key;
    ASSERT EXISTS (SELECT 1 FROM academy_sales_kpi_activity WHERE lead_id = lead_key AND source_key = 'instagram:' || message_key), 'Sent Instagram message is captured';
  END IF;

  INSERT INTO academy_students (contact_name, manager_id, referral_code)
    VALUES ('KPI verification without lead', closer, 'kpi-verify-second-' || hunter) RETURNING id INTO second_student;
  INSERT INTO academy_payments (student_id, amount_uzs, type, status, paid_at)
    VALUES (second_student, 100000, 'installment_2_2', 'paid', timezone('UTC', now())) RETURNING id INTO second_payment;
  ASSERT (SELECT kind = 'installment' AND closer_id = closer FROM academy_sales_kpi_sales WHERE payment_id = second_payment), 'Second installment stays excluded even without prior payment';
  INSERT INTO academy_parent_surveys (student_id, period, nps_score)
    VALUES (second_student, month_key, 9) RETURNING id INTO survey_key;
  ASSERT (SELECT closer_id = closer FROM academy_sales_kpi_surveys WHERE survey_id = survey_key), 'Survey fallback without a lead';

  SELECT payment.id INTO legacy_key FROM academy_payments payment LEFT JOIN academy_sales_kpi_sales fact ON fact.payment_id = payment.id
    WHERE payment.status = 'paid' AND fact.payment_id IS NULL LIMIT 1;
  IF legacy_key IS NOT NULL THEN
    UPDATE academy_payments SET comment = comment WHERE id = legacy_key;
    ASSERT NOT EXISTS (SELECT 1 FROM academy_sales_kpi_sales WHERE payment_id = legacy_key), 'Legacy payment edits are not new achievements';
  END IF;
  SELECT participant.id INTO legacy_key FROM academy_demo_lesson_participants participant
    LEFT JOIN academy_sales_kpi_trials fact ON fact.participant_id = participant.id
    WHERE participant.status IN ('confirmed', 'attended', 'no_show') AND fact.participant_id IS NULL LIMIT 1;
  IF legacy_key IS NOT NULL THEN
    UPDATE academy_demo_lesson_participants SET result = result WHERE id = legacy_key;
    ASSERT NOT EXISTS (SELECT 1 FROM academy_sales_kpi_trials WHERE participant_id = legacy_key), 'Legacy trial edits are not new bookings';
  END IF;

  INSERT INTO academy_sales_kpi_assignments (user_id, effective_month, role)
    VALUES (hunter, to_char((now() AT TIME ZONE 'Asia/Tashkent') + interval '1 month', 'YYYY-MM'), 'closer');
  ASSERT academy_kpi_employee_role(hunter) = 'hunter', 'Future assignment cannot change this month';
  UPDATE users SET is_active = false WHERE id = hunter;
  ASSERT academy_kpi_employee_role(hunter) IS NULL, 'Inactive employee receives no new attribution';
  ASSERT (SELECT hunter_id = hunter FROM academy_sales_kpi_trials WHERE participant_id = participant_key), 'Archived/inactive owner history is preserved';
  RAISE NOTICE 'KPI trigger verification passed: lead, contact, handoff, attendance, offer, sales, refund, NPS, calls, Instagram, history, role changes';
END
$verify$;
ROLLBACK;
