-- Freeze attendance writes while legacy values are audited, normalized, and
-- protected by the final constraint. The migration runner wraps this file in
-- one transaction, so no invalid value can appear between these operations.
LOCK TABLE "academy_attendance" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

INSERT INTO "audit_logs" (
  "action",
  "entity_type",
  "entity_id",
  "old_values",
  "new_values"
)
SELECT
  'academy_attendance_legacy_status_normalized',
  'academy_attendance',
  attendance."id",
  jsonb_build_object('status', attendance."status"),
  jsonb_build_object(
    'status',
    CASE
      WHEN LOWER(BTRIM(attendance."status")) = 'present' THEN 'present'
      ELSE 'absent'
    END,
    'reason',
    CASE
      WHEN LOWER(BTRIM(attendance."status")) IN ('present', 'absent')
        THEN 'canonicalized_legacy_status'
      ELSE 'unknown_legacy_status_defaulted_absent'
    END
  )
FROM "academy_attendance" AS attendance
WHERE attendance."status" NOT IN ('present', 'absent');
--> statement-breakpoint

UPDATE "academy_attendance" AS attendance
SET "status" = CASE
      WHEN LOWER(BTRIM(attendance."status")) = 'present' THEN 'present'
      ELSE 'absent'
    END,
    "updated_at" = NOW()
WHERE attendance."status" NOT IN ('present', 'absent');
--> statement-breakpoint

ALTER TABLE "academy_attendance"
  ADD CONSTRAINT "academy_attendance_status_check"
  CHECK ("status" IN ('present', 'absent'));
--> statement-breakpoint

CREATE INDEX "academy_attendance_student_idx"
  ON "academy_attendance" USING btree ("student_id");
--> statement-breakpoint

CREATE INDEX "academy_lesson_reschedules_changed_by_idx"
  ON "academy_lesson_reschedules" USING btree ("changed_by");
