-- No existing leads, payments or company targets are deleted. Tracking starts
-- here; pre-existing work is not attributed retroactively to a current manager.
CREATE TABLE academy_sales_kpi_meta (
  id integer PRIMARY KEY CHECK (id = 1),
  tracking_started_at timestamp NOT NULL DEFAULT timezone('UTC', now())
);
INSERT INTO academy_sales_kpi_meta (id) VALUES (1);

CREATE TABLE academy_sales_kpi_plans (
  id serial PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('hunter', 'closer')),
  effective_month text NOT NULL CHECK (effective_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT timezone('UTC', now())
);
CREATE INDEX academy_sales_kpi_plans_version_idx ON academy_sales_kpi_plans(role, effective_month DESC, id DESC);

CREATE TABLE academy_sales_kpi_assignments (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_month text NOT NULL CHECK (effective_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  role text CHECK (role IN ('hunter', 'closer')),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT timezone('UTC', now()),
  PRIMARY KEY (user_id, effective_month)
);

CREATE TABLE academy_sales_kpi_leads (
  lead_id integer PRIMARY KEY REFERENCES academy_leads(id) ON DELETE CASCADE,
  hunter_id integer REFERENCES users(id) ON DELETE SET NULL,
  closer_id integer REFERENCES users(id) ON DELETE SET NULL,
  received_at timestamp NOT NULL,
  tracked_at timestamp NOT NULL,
  first_response_at timestamp,
  qualified_at timestamp,
  crm_completed_at timestamp,
  offer_at timestamp,
  reactivated_at timestamp,
  created_at timestamp NOT NULL DEFAULT timezone('UTC', now())
);
CREATE INDEX academy_sales_kpi_leads_hunter_idx ON academy_sales_kpi_leads(hunter_id, received_at);
CREATE INDEX academy_sales_kpi_leads_closer_idx ON academy_sales_kpi_leads(closer_id);

CREATE TABLE academy_sales_kpi_activity (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES academy_leads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('contact', 'cold', 'reactivated')),
  source_key text NOT NULL UNIQUE,
  occurred_at timestamp NOT NULL DEFAULT timezone('UTC', now())
);
CREATE INDEX academy_sales_kpi_activity_lead_idx ON academy_sales_kpi_activity(lead_id, occurred_at DESC, id DESC);

CREATE TABLE academy_sales_kpi_trials (
  participant_id integer PRIMARY KEY REFERENCES academy_demo_lesson_participants(id) ON DELETE CASCADE,
  hunter_id integer REFERENCES users(id) ON DELETE SET NULL,
  closer_id integer REFERENCES users(id) ON DELETE SET NULL,
  booked_at timestamp NOT NULL DEFAULT timezone('UTC', now()),
  reactivated boolean NOT NULL DEFAULT false
);
CREATE INDEX academy_sales_kpi_trials_hunter_idx ON academy_sales_kpi_trials(hunter_id);
CREATE INDEX academy_sales_kpi_trials_closer_idx ON academy_sales_kpi_trials(closer_id);

CREATE TABLE academy_sales_kpi_sales (
  payment_id integer PRIMARY KEY REFERENCES academy_payments(id) ON DELETE CASCADE,
  closer_id integer REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('new', 'renewal', 'upsell', 'installment', 'unclassified')),
  cycle_key text CHECK (cycle_key IS NULL OR length(cycle_key) BETWEEN 1 AND 120),
  referral_initiated boolean NOT NULL DEFAULT false,
  reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT timezone('UTC', now()),
  CHECK (kind NOT IN ('renewal', 'upsell') OR cycle_key IS NOT NULL)
);
CREATE INDEX academy_sales_kpi_sales_closer_idx ON academy_sales_kpi_sales(closer_id);

CREATE TABLE academy_sales_kpi_surveys (
  survey_id integer PRIMARY KEY REFERENCES academy_parent_surveys(id) ON DELETE CASCADE,
  closer_id integer REFERENCES users(id) ON DELETE SET NULL
);

-- Current eligibility is checked when attributing a new event. Existing facts
-- retain their owner when an employee changes role, loses access or is archived.
CREATE FUNCTION academy_kpi_employee_role(p_user integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT assignment.role FROM academy_sales_kpi_assignments assignment
  JOIN users employee ON employee.id = assignment.user_id
  WHERE assignment.user_id = p_user
    AND assignment.effective_month <= to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')
    AND employee.is_active = true AND employee.is_archived = false
    AND (employee.module = 'sales' OR EXISTS (
      SELECT 1 FROM user_modules WHERE user_id = employee.id AND module = 'sales'
    ))
  ORDER BY assignment.effective_month DESC LIMIT 1
$$;

CREATE FUNCTION academy_kpi_touch_lead(p_lead integer) RETURNS void LANGUAGE plpgsql AS $$
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
  VALUES (lead.id, CASE WHEN assigned_role = 'hunter' THEN lead.manager_id END,
    CASE WHEN assigned_role = 'closer' THEN lead.manager_id END, lead.created_at, tracking_start)
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
  -- Attended trials may be handed to a closer after the lesson. Only an
  -- unassigned closer slot is filled; previously attributed events never move.
  UPDATE academy_sales_kpi_trials trial SET closer_id = tracked.closer_id
  FROM academy_demo_lesson_participants participant, academy_students student, academy_sales_kpi_leads tracked
  WHERE trial.participant_id = participant.id AND participant.student_id = student.id
    AND student.lead_id = p_lead AND tracked.lead_id = p_lead
    AND trial.closer_id IS NULL AND tracked.closer_id IS NOT NULL;
END
$$;

CREATE FUNCTION academy_kpi_record_contact(p_lead integer, p_at timestamp, p_key text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_lead IS NULL OR p_at IS NULL OR p_at > timezone('UTC', now()) THEN RETURN; END IF;
  PERFORM academy_kpi_touch_lead(p_lead);
  UPDATE academy_sales_kpi_leads SET first_response_at = LEAST(first_response_at, p_at)
  WHERE lead_id = p_lead AND p_at >= received_at AND p_at >= tracked_at;
  IF FOUND THEN
    INSERT INTO academy_sales_kpi_activity (lead_id, kind, source_key, occurred_at)
    VALUES (p_lead, 'contact', p_key, p_at) ON CONFLICT (source_key) DO NOTHING;
  END IF;
END
$$;

CREATE FUNCTION academy_kpi_capture_lead() RETURNS trigger LANGUAGE plpgsql AS $$
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
  is_cold := NEW.status_code = 'not_now' OR NEW.is_archived;
  IF TG_OP = 'UPDATE' THEN
    was_complete := OLD.student_age IS NOT NULL AND OLD.student_age > 0 AND OLD.course_id IS NOT NULL
      AND COALESCE(NULLIF(btrim(OLD.phone), ''), NULLIF(btrim(OLD.messenger), '')) IS NOT NULL
      AND NULLIF(btrim(OLD.contact_name), '') IS NOT NULL;
    was_cold := OLD.status_code = 'not_now' OR OLD.is_archived;
  END IF;
  IF is_complete THEN
    UPDATE academy_sales_kpi_leads SET crm_completed_at = COALESCE(crm_completed_at, clock_at),
      qualified_at = CASE WHEN NOT was_complete THEN COALESCE(qualified_at, clock_at) ELSE qualified_at END
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

CREATE FUNCTION academy_kpi_capture_trial() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_lead integer;
  assigned_manager integer;
  tracked academy_sales_kpi_leads%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('confirmed', 'attended', 'no_show') THEN RETURN NEW; END IF;
  -- Updating a pre-launch booking is not a new booking this month.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('confirmed', 'attended', 'no_show')
    AND NOT EXISTS (SELECT 1 FROM academy_sales_kpi_trials WHERE participant_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT lead_id, manager_id INTO linked_lead, assigned_manager FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  SELECT * INTO tracked FROM academy_sales_kpi_leads WHERE lead_id = linked_lead;
  INSERT INTO academy_sales_kpi_trials (participant_id, hunter_id, closer_id, reactivated)
  VALUES (NEW.id, COALESCE(tracked.hunter_id, CASE WHEN academy_kpi_employee_role(assigned_manager) = 'hunter' THEN assigned_manager END),
    COALESCE(tracked.closer_id, CASE WHEN academy_kpi_employee_role(assigned_manager) = 'closer' THEN assigned_manager END),
    COALESCE(tracked.reactivated_at IS NOT NULL, false))
  ON CONFLICT (participant_id) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER academy_kpi_trial_capture AFTER INSERT OR UPDATE ON academy_demo_lesson_participants
FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_trial();

CREATE FUNCTION academy_kpi_capture_sale() RETURNS trigger LANGUAGE plpgsql AS $$
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
  -- Serializes concurrent first payments, including callers outside the CRM's
  -- payment route. Refunded past payments still identify an existing student.
  PERFORM 1 FROM academy_students WHERE id = NEW.student_id FOR UPDATE;
  SELECT COALESCE(NEW.lead_id, lead_id), manager_id INTO linked_lead, assigned_manager
    FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  SELECT closer_id INTO attributed_closer FROM academy_sales_kpi_leads WHERE lead_id = linked_lead;
  IF attributed_closer IS NULL AND academy_kpi_employee_role(assigned_manager) = 'closer' THEN
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
CREATE TRIGGER academy_kpi_sale_capture AFTER INSERT OR UPDATE ON academy_payments
FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_sale();

CREATE FUNCTION academy_kpi_capture_survey() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_lead integer; assigned_manager integer;
BEGIN
  SELECT lead_id, manager_id INTO linked_lead, assigned_manager FROM academy_students WHERE id = NEW.student_id;
  PERFORM academy_kpi_touch_lead(linked_lead);
  INSERT INTO academy_sales_kpi_surveys (survey_id, closer_id)
    VALUES (NEW.id, COALESCE((SELECT closer_id FROM academy_sales_kpi_leads WHERE lead_id = linked_lead),
      CASE WHEN academy_kpi_employee_role(assigned_manager) = 'closer' THEN assigned_manager END))
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER academy_kpi_survey_capture AFTER INSERT OR UPDATE ON academy_parent_surveys
FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_survey();

CREATE FUNCTION academy_kpi_capture_communication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_lead integer;
BEGIN
  linked_lead := NEW.lead_id;
  IF linked_lead IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT lead_id INTO linked_lead FROM academy_students WHERE id = NEW.student_id;
  END IF;
  PERFORM academy_kpi_record_contact(linked_lead, NEW.created_at, 'communication:' || NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER academy_kpi_communication_capture AFTER INSERT ON academy_communications
FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_communication();

CREATE FUNCTION academy_kpi_capture_call() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_lead integer;
BEGIN
  linked_lead := COALESCE(NEW.lead_id, CASE WHEN NEW.contact_type = 'lead' THEN NEW.contact_id END);
  IF linked_lead IS NULL AND NEW.contact_type = 'student' THEN
    SELECT lead_id INTO linked_lead FROM academy_students WHERE id = NEW.contact_id;
  END IF;
  IF NEW.direction = 'outgoing' AND NEW.status IN ('dialing', 'ringing', 'connected', 'ended', 'declined', 'missed') THEN
    PERFORM academy_kpi_record_contact(linked_lead, NEW.started_at, 'call:' || NEW.id);
  ELSIF NEW.direction = 'incoming' AND NEW.answered_at IS NOT NULL THEN
    PERFORM academy_kpi_record_contact(linked_lead, NEW.answered_at, 'call:' || NEW.id);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER academy_kpi_call_capture AFTER INSERT OR UPDATE ON telephony_calls
FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_call();

CREATE FUNCTION academy_kpi_capture_instagram() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_lead integer;
BEGIN
  IF NEW.direction = 'outbound' AND NEW.status IN ('sent', 'delivered', 'read') THEN
    SELECT lead_id INTO linked_lead FROM instagram_conversations WHERE id = NEW.conversation_id;
    PERFORM academy_kpi_record_contact(linked_lead, NEW.created_at, 'instagram:' || NEW.id);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER academy_kpi_instagram_capture AFTER INSERT OR UPDATE ON instagram_messages
FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_instagram();

-- Default versions; later edits append a new effective-month version.
INSERT INTO academy_sales_kpi_plans (role, effective_month, config) VALUES ('hunter', to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'), '{"baseSalaryUzs":3000000,"baseSalaryMode":"guaranteed","variableSalaryUzs":700000,"minimumVolume":30,"volumeTarget":30,"conversionTargetPercent":60,"crmTargetPercent":100,"qualifiedTarget":0,"responseTargetMinutes":5,"responseBaseMinutes":15,"offerNextDayHour":11,"workdayStartHour":9,"workdayEndHour":20,"workdays":[1,2,3,4,5,6],"reactivationDays":14,"conversionWindowDays":30,"qualityBonusUzs":200000,"qualityThresholdPercent":70,"qualityThresholdInclusive":false,"reactivationBonusUzs":100000,"renewalBonusUzs":0,"upsellBonusUzs":0,"referralBonusUzs":0,"renewalTargetPercent":0,"upsellTarget":0,"npsTarget":50,"tiers":[{"from":1,"rateUzs":70000},{"from":31,"rateUzs":100000}],"enabledMetrics":["response","qualified","bookings","attendance","crm","reactivation","reactivatedAttendance"]}'::jsonb);
INSERT INTO academy_sales_kpi_plans (role, effective_month, config) VALUES ('closer', to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'), '{"baseSalaryUzs":3500000,"baseSalaryMode":"guaranteed","variableSalaryUzs":500000,"minimumVolume":15,"volumeTarget":21,"conversionTargetPercent":50,"crmTargetPercent":100,"qualifiedTarget":0,"responseTargetMinutes":5,"responseBaseMinutes":15,"offerNextDayHour":11,"workdayStartHour":9,"workdayEndHour":20,"workdays":[1,2,3,4,5,6],"reactivationDays":14,"conversionWindowDays":30,"qualityBonusUzs":0,"qualityThresholdPercent":70,"qualityThresholdInclusive":false,"reactivationBonusUzs":0,"renewalBonusUzs":100000,"upsellBonusUzs":75000,"referralBonusUzs":125000,"renewalTargetPercent":0,"upsellTarget":0,"npsTarget":50,"tiers":[{"from":1,"rateUzs":150000},{"from":22,"rateUzs":200000},{"from":28,"rateUzs":250000},{"from":34,"rateUzs":300000}],"enabledMetrics":["newStudents","trialConversion","offer","crm","renewals","renewalConversion","upsells","referrals","nps"]}'::jsonb);
