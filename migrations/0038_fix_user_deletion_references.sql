ALTER TABLE "notifications"
  DROP CONSTRAINT IF EXISTS "notifications_user_id_users_id_fk";

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "audit_logs"
  DROP CONSTRAINT IF EXISTS "audit_logs_user_id_users_id_fk";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
