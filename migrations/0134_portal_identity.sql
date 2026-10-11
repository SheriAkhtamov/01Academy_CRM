-- Additive portal identity schema. Staff users, staff sessions and CRM records remain unchanged.
CREATE TABLE portal_accounts (
  id serial PRIMARY KEY,
  last_seen_at timestamptz,
  login varchar(32) NOT NULL UNIQUE CHECK (login = lower(login) AND login ~ '^[a-z0-9._-]{4,32}$'),
  full_name varchar(255) NOT NULL,
  email varchar(254), email_verified_at timestamptz, pending_email varchar(254),
  phone varchar(50), locale varchar(5) NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru','en')),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','archived')),
  password_hash text, auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NULL OR email = lower(email)), CHECK (email_verified_at IS NULL OR email IS NOT NULL),
  CHECK (status <> 'active' OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX portal_accounts_verified_email_unique ON portal_accounts(email) WHERE email_verified_at IS NOT NULL;
CREATE TABLE portal_account_contacts (
  id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CHECK (kind IN ('email','phone')), normalized_value varchar(254) NOT NULL,
  verified_at timestamptz, verification_method varchar(120), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,kind,normalized_value)
);
CREATE TABLE portal_student_identity (
  student_id integer PRIMARY KEY REFERENCES academy_students(id) ON DELETE CASCADE,
  classification varchar(16) NOT NULL DEFAULT 'unverified' CHECK (classification IN ('adult','minor','unverified')),
  verified_birth_date date, verified_at timestamptz NOT NULL, verified_by integer REFERENCES users(id) ON DELETE SET NULL,
  verification_method varchar(120) NOT NULL
);
CREATE TABLE portal_student_links (
  id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  student_id integer NOT NULL REFERENCES academy_students(id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL CHECK (kind IN ('self','representative')),
  relationship varchar(20) CHECK (relationship IN ('parent','guardian','payer','other')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions) = 'array'),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','revoked')),
  verified_at timestamptz, verified_by integer REFERENCES users(id) ON DELETE SET NULL, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'self' AND relationship IS NULL) OR (kind = 'representative' AND relationship IS NOT NULL)),
  CHECK (permissions <@ '["learning.read","attendance.read","feedback.read","finance.read","communication.create","portfolio.approve","child_credentials.manage","assignments.submit","quizzes.attempt","portfolio.edit"]'::jsonb),
  CHECK (kind = 'self' OR NOT (permissions ?| ARRAY['assignments.submit','quizzes.attempt','portfolio.edit'])),
  CHECK (status <> 'active' OR verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX portal_student_links_live_pair_unique ON portal_student_links(account_id,student_id) WHERE status <> 'revoked';
CREATE UNIQUE INDEX portal_student_links_self_student_unique ON portal_student_links(student_id) WHERE kind = 'self' AND status <> 'revoked';
CREATE UNIQUE INDEX portal_student_links_self_account_unique ON portal_student_links(account_id) WHERE kind = 'self' AND status <> 'revoked';
CREATE INDEX portal_student_links_account_idx ON portal_student_links(account_id,status);
CREATE TABLE portal_consents (
  id serial PRIMARY KEY, link_id integer NOT NULL REFERENCES portal_student_links(id) ON DELETE RESTRICT,
  permissions jsonb NOT NULL CHECK (jsonb_typeof(permissions) = 'array'),
  subject_account_id integer REFERENCES portal_accounts(id) ON DELETE SET NULL,
  method varchar(30) NOT NULL CHECK (method IN ('in_person','portal','staff_verification')),
  staff_id integer REFERENCES users(id) ON DELETE SET NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (subject_account_id IS NOT NULL AND staff_id IS NOT NULL))
);
CREATE TABLE portal_invitations (
  id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  link_id integer NOT NULL REFERENCES portal_student_links(id) ON DELETE RESTRICT,
  token_hash varchar(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created','sent','delivery_failed','accepted','expired','revoked')),
  channel varchar(10) NOT NULL CHECK (channel IN ('manual','email')),
  created_by integer REFERENCES users(id) ON DELETE SET NULL, idempotency_key uuid NOT NULL UNIQUE, request_hash varchar(64) NOT NULL,
  accepted_at timestamptz, accepted_account_id integer REFERENCES portal_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_invitations_link_idx ON portal_invitations(link_id,id DESC);
CREATE TABLE portal_recovery_tokens (
  id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  purpose varchar(10) NOT NULL CHECK (purpose IN ('recovery','email')), token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, payload varchar(254), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal_sessions (
  id varchar(64) PRIMARY KEY, account_id integer REFERENCES portal_accounts(id) ON DELETE CASCADE,
  auth_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL, csrf_token varchar(64) NOT NULL, reauthenticated_at timestamptz
);
CREATE INDEX portal_sessions_account_idx ON portal_sessions(account_id);
CREATE INDEX portal_sessions_expiry_idx ON portal_sessions(absolute_expires_at);
CREATE TABLE portal_access_audit (
  id bigserial PRIMARY KEY, actor_kind varchar(10) NOT NULL CHECK (actor_kind IN ('staff','portal','anonymous')),
  staff_id integer REFERENCES users(id) ON DELETE SET NULL, account_id integer REFERENCES portal_accounts(id) ON DELETE SET NULL,
  student_id integer REFERENCES academy_students(id) ON DELETE SET NULL,
  action varchar(80) NOT NULL, request_id varchar(120), details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_kind = 'staff' AND account_id IS NULL) OR (actor_kind = 'portal' AND staff_id IS NULL) OR (actor_kind = 'anonymous' AND account_id IS NULL AND staff_id IS NULL))
);
CREATE INDEX portal_access_audit_student_idx ON portal_access_audit(student_id,created_at DESC);
CREATE TABLE portal_rate_limits (
  key varchar(100) PRIMARY KEY, count integer NOT NULL DEFAULT 0 CHECK (count >= 0), reset_at timestamptz NOT NULL
);
CREATE INDEX portal_rate_limits_reset_idx ON portal_rate_limits(reset_at);
CREATE TABLE portal_identity_mail_outbox (
  id bigserial PRIMARY KEY, account_id integer NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  recipient varchar(254) NOT NULL, template varchar(30) NOT NULL CHECK (template IN ('invitation','recovery','email_change','email_changed')),
  encrypted_payload text, expires_at timestamptz NOT NULL, invitation_id integer REFERENCES portal_invitations(id) ON DELETE SET NULL,
  dedupe_key varchar(100) NOT NULL UNIQUE, status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','sent','failed','expired')),
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, delivered_at timestamptz,
  last_error_code varchar(60), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_identity_mail_outbox_pending_idx ON portal_identity_mail_outbox(status,available_at);
