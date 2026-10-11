-- New portal resources are additive; flags start disabled and existing CRM reads are unchanged.
CREATE TABLE lms_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  all_groups boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  group_ids integer[] NOT NULL DEFAULT '{}',
  updated_by integer REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO lms_feature_flags(key) VALUES ('learning'), ('invitations'), ('public_portfolio'), ('email');

CREATE TABLE lms_school_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  settings jsonb NOT NULL DEFAULT '{"maxFileMiB":100,"studentQuotaGiB":5,"schoolQuotaGiB":20,"materialAccessDays":365,"childFinanceVisible":false,"workCalendar":{"workdays":[1,2,3,4,5],"start":"09:00","end":"18:00","holidays":[],"coordinatorUserIds":[]},"achievementTemplates":[]}',
  updated_by integer REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO lms_school_settings(singleton) VALUES(true);

CREATE TABLE lms_legacy_imports (
  source_type text NOT NULL,
  source_id bigint NOT NULL,
  source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  target_type text NOT NULL,
  target_id bigint NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_type,source_id)
);
CREATE TABLE lms_legacy_import_checkpoints (
  scope text PRIMARY KEY,
  last_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lms_legacy_portfolio_drafts (
  project_id integer PRIMARY KEY REFERENCES academy_portfolio_projects(id) ON DELETE CASCADE,
  source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','reviewed')),
  prepared_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lms_files (
  id bigserial PRIMARY KEY,
  owner_account_id bigint REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  owner_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  student_id integer REFERENCES academy_students(id) ON DELETE RESTRICT,
  run_id bigint REFERENCES lms_group_runs(id) ON DELETE RESTRICT,
  recipient_id bigint REFERENCES lms_assignment_recipients(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 104857600),
  storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^[a-zA-Z0-9_-]{20,80}$'),
  sha256 text CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','checking','ready','rejected')),
  rejection_code text,
  scan_attempts integer NOT NULL DEFAULT 0 CHECK(scan_attempts>=0),
  scan_after timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  attached_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((owner_account_id IS NULL)<>(owner_user_id IS NULL)),
  CHECK(owner_account_id IS NULL OR student_id IS NOT NULL)
);
CREATE INDEX lms_files_owner ON lms_files(owner_account_id,student_id) WHERE deleted_at IS NULL;
CREATE INDEX lms_files_scan_queue ON lms_files(scan_after,id) WHERE state='checking' AND deleted_at IS NULL;

CREATE TABLE lms_staff_file_copies (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key text NOT NULL,
  source_file_id bigint NOT NULL REFERENCES lms_files(id) ON DELETE RESTRICT,
  target_run_id bigint NOT NULL REFERENCES lms_group_runs(id) ON DELETE RESTRICT,
  file_id bigint NOT NULL REFERENCES lms_files(id) ON DELETE RESTRICT,
  PRIMARY KEY(user_id,request_key,source_file_id,target_run_id)
);

ALTER TABLE academy_portfolio_projects
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lms_run_id bigint REFERENCES lms_group_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_submission_id bigint REFERENCES lms_submissions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS file_ids jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cover_file_id bigint REFERENCES lms_files(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS teacher_review text,
  ADD COLUMN IF NOT EXISTS reviewed_by integer REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS portal_version integer NOT NULL DEFAULT 1 CHECK(portal_version>0),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE lms_portfolio_shares (
  id bigserial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES academy_portfolio_projects(id) ON DELETE RESTRICT,
  project_version integer NOT NULL CHECK(project_version>0),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  token_envelope text NOT NULL,
  status text NOT NULL CHECK(status IN ('awaiting_approval','awaiting_moderation','published','rejected','revoked')),
  snapshot jsonb NOT NULL,
  requested_by bigint NOT NULL REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  student_consent_at timestamptz NOT NULL DEFAULT now(),
  student_classification text NOT NULL CHECK(student_classification IN ('adult','minor')),
  approved_by bigint REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  moderated_by integer REFERENCES users(id) ON DELETE RESTRICT,
  moderated_at timestamptz,
  expires_at timestamptz,
  published_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lms_portfolio_moderation ON lms_portfolio_shares(status,created_at);

CREATE TABLE lms_project_comparisons (
  id bigserial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES academy_students(id) ON DELETE RESTRICT,
  run_id bigint REFERENCES lms_group_runs(id) ON DELETE RESTRICT,
  first_project_id integer NOT NULL REFERENCES academy_portfolio_projects(id) ON DELETE RESTRICT,
  latest_project_id integer NOT NULL REFERENCES academy_portfolio_projects(id) ON DELETE RESTRICT,
  first_snapshot jsonb NOT NULL,
  latest_snapshot jsonb NOT NULL,
  selected_by_account bigint REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  selected_by_user integer REFERENCES users(id) ON DELETE RESTRICT,
  selected_by_name text NOT NULL,
  selected_by_role text NOT NULL CHECK(selected_by_role IN ('student','teacher','staff')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(first_project_id<>latest_project_id),
  CHECK((selected_by_account IS NULL)<>(selected_by_user IS NULL)),
  UNIQUE NULLS NOT DISTINCT(student_id,run_id)
);

CREATE TABLE academy_payment_student_allocations (
  payment_id integer NOT NULL REFERENCES academy_payments(id) ON DELETE RESTRICT,
  student_id integer NOT NULL REFERENCES academy_students(id) ON DELETE RESTRICT,
  amount_uzs bigint NOT NULL CHECK(amount_uzs>0),
  assigned_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(trim(reason))>=3),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(payment_id,student_id)
);
CREATE INDEX academy_payment_allocations_student ON academy_payment_student_allocations(student_id);
CREATE FUNCTION check_academy_payment_allocation_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_value bigint; allocation_value bigint; target_id integer;
BEGIN
  target_id := CASE WHEN TG_OP='DELETE' THEN OLD.payment_id ELSE NEW.payment_id END;
  SELECT amount_uzs INTO payment_value FROM academy_payments WHERE id=target_id FOR UPDATE;
  SELECT COALESCE(sum(amount_uzs),0) INTO allocation_value FROM academy_payment_student_allocations WHERE payment_id=target_id;
  IF allocation_value>payment_value THEN RAISE EXCEPTION 'paymentAllocationExceedsAmount' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER academy_payment_allocation_total
  AFTER INSERT OR UPDATE OR DELETE ON academy_payment_student_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_academy_payment_allocation_total();
CREATE FUNCTION check_academy_payment_allocated_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE((SELECT sum(amount_uzs) FROM academy_payment_student_allocations WHERE payment_id=NEW.id),0)>NEW.amount_uzs
  THEN RAISE EXCEPTION 'paymentAllocationExceedsAmount' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER academy_payment_allocated_amount BEFORE UPDATE OF amount_uzs ON academy_payments
  FOR EACH ROW EXECUTE FUNCTION check_academy_payment_allocated_amount();

CREATE TABLE portal_notification_preferences (
  account_id bigint PRIMARY KEY REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  categories jsonb NOT NULL,
  quiet_from time NOT NULL DEFAULT '21:00',
  quiet_until time NOT NULL DEFAULT '08:00',
  weekly_summary boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal_notifications (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  link_id bigint REFERENCES portal_student_links(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK(category IN ('learning','schedule','feedback','finance','family','security')),
  code text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  href text,
  event_key text NOT NULL,
  required_permission text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE(account_id,event_key)
);
CREATE INDEX portal_notifications_account ON portal_notifications(account_id,id DESC);
CREATE INDEX portal_notifications_unread ON portal_notifications(account_id) WHERE read_at IS NULL;

CREATE TABLE portal_finance_questions (
  id bigserial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES academy_students(id) ON DELETE RESTRICT,
  payment_id integer REFERENCES academy_payments(id) ON DELETE RESTRICT,
  account_id bigint NOT NULL REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  link_id bigint NOT NULL REFERENCES portal_student_links(id) ON DELETE RESTRICT,
  subject text NOT NULL CHECK(length(trim(subject)) BETWEEN 1 AND 255),
  request_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,request_key)
);
CREATE INDEX portal_finance_questions_account ON portal_finance_questions(account_id,student_id,id DESC);
CREATE INDEX portal_finance_questions_queue ON portal_finance_questions(status,created_at);
CREATE TABLE portal_finance_question_messages (
  id bigserial PRIMARY KEY,
  question_id bigint NOT NULL REFERENCES portal_finance_questions(id) ON DELETE RESTRICT,
  account_id bigint REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 10000),
  request_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((account_id IS NULL)<>(user_id IS NULL)),
  UNIQUE(question_id,account_id,request_key),
  UNIQUE(question_id,user_id,request_key)
);
CREATE INDEX portal_finance_messages_thread ON portal_finance_question_messages(question_id,id);

CREATE TABLE lms_resource_outbox (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  link_id bigint REFERENCES portal_student_links(id) ON DELETE RESTRICT,
  category text NOT NULL,
  code text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  href text,
  event_key text NOT NULL,
  required_permission text,
  channel text NOT NULL CHECK(channel IN ('in_app','email')),
  urgent boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','cancelled','failed')),
  attempts integer NOT NULL DEFAULT 0,
  deliver_after timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  locked_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,event_key,channel)
);
CREATE INDEX lms_resource_outbox_due ON lms_resource_outbox(deliver_after,id) WHERE state='pending';
CREATE TABLE lms_notification_worker_state (key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE lms_notification_sources (source_key text PRIMARY KEY,handled_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE lms_staff_notification_events (user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,event_key text NOT NULL,PRIMARY KEY(user_id,event_key));
CREATE TABLE lms_resource_audit (
  id bigserial PRIMARY KEY,
  request_id text,
  portal_account_id bigint REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  staff_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  student_id integer REFERENCES academy_students(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id bigint,
  changes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((portal_account_id IS NULL)<>(staff_user_id IS NULL))
);
CREATE UNIQUE INDEX lms_resource_creation_receipt ON lms_resource_audit(portal_account_id,action,(changes->>'requestKey')) WHERE changes ? 'requestKey';
ALTER TABLE academy_payments ADD COLUMN IF NOT EXISTS allocation_version integer NOT NULL DEFAULT 0 CHECK(allocation_version>=0);
ALTER TABLE academy_portfolio_projects ADD COLUMN IF NOT EXISTS portal_created boolean NOT NULL DEFAULT false;
