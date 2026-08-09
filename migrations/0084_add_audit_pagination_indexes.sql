CREATE INDEX IF NOT EXISTS "audit_logs_created_at_id_idx"
  ON "audit_logs" USING btree ("created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "academy_integration_logs_created_at_id_idx"
  ON "academy_integration_logs" USING btree ("created_at" DESC, "id" DESC);
