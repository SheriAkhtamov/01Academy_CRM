-- Email delivery is removed. Contact addresses remain ordinary CRM contact data.
DROP TABLE portal_identity_mail_outbox;
DROP TABLE portal_recovery_tokens;
ALTER TABLE portal_accounts DROP COLUMN email_verified_at, DROP COLUMN pending_email;

DELETE FROM lms_resource_outbox WHERE channel='email';
ALTER TABLE lms_resource_outbox DROP CONSTRAINT lms_resource_outbox_channel_check;
ALTER TABLE lms_resource_outbox ADD CONSTRAINT lms_resource_outbox_channel_check CHECK(channel='in_app');
UPDATE portal_invitations SET channel='manual' WHERE channel='email';
ALTER TABLE portal_invitations DROP CONSTRAINT portal_invitations_channel_check;
ALTER TABLE portal_invitations ADD CONSTRAINT portal_invitations_channel_check CHECK(channel='manual');
DELETE FROM lms_feature_flags WHERE key='email';

UPDATE portal_notification_preferences preference SET categories=(
  SELECT jsonb_object_agg(category.key,jsonb_build_object('inApp',COALESCE((category.value->>'inApp')::boolean,true)))
  FROM jsonb_each(preference.categories) category
);
ALTER TABLE portal_notification_preferences DROP COLUMN quiet_from, DROP COLUMN quiet_until;

CREATE TABLE portal_initial_credentials (
  account_id integer PRIMARY KEY CONSTRAINT portal_initial_credentials_account_fkey REFERENCES portal_accounts(id) ON DELETE CASCADE,
  auth_version integer NOT NULL CONSTRAINT portal_initial_credentials_version_check CHECK(auth_version>0),
  encrypted_password text,
  expires_at timestamptz NOT NULL,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal_lead_accounts (
  lead_id integer PRIMARY KEY CONSTRAINT portal_lead_accounts_lead_fkey REFERENCES academy_leads(id) ON DELETE CASCADE,
  account_id integer NOT NULL CONSTRAINT portal_lead_accounts_account_fkey REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  role varchar(16) NOT NULL CONSTRAINT portal_lead_accounts_role_check CHECK(role IN('self','representative')),
  student_id integer CONSTRAINT portal_lead_accounts_student_fkey REFERENCES academy_students(id) ON DELETE RESTRICT,
  verified_by integer CONSTRAINT portal_lead_accounts_verifier_fkey REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_lead_accounts_student_check CHECK((role='self' AND student_id IS NOT NULL) OR (role='representative' AND student_id IS NULL))
);

ALTER TABLE portal_access_audit DROP CONSTRAINT portal_access_audit_actor_kind_check, DROP CONSTRAINT portal_access_audit_check;
ALTER TABLE portal_access_audit ADD CONSTRAINT portal_access_audit_actor_kind_check CHECK(actor_kind IN('staff','portal','anonymous','system'));
ALTER TABLE portal_access_audit ADD CONSTRAINT portal_access_audit_check CHECK(
  (actor_kind='staff' AND account_id IS NULL)
  OR (actor_kind='portal' AND staff_id IS NULL)
  OR (actor_kind IN('anonymous','system') AND account_id IS NULL AND staff_id IS NULL)
);
