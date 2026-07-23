CREATE TEMP TABLE academy_automatic_lead_stage_repairs ON COMMIT DROP AS
WITH latest_history AS (
  SELECT DISTINCT ON (history."lead_id")
    history."id" AS "history_id",
    history."lead_id",
    history."from_status_code",
    history."to_status_code",
    history."entered_at",
    history."comment"
  FROM "academy_lead_stage_history" history
  ORDER BY
    history."lead_id",
    history."entered_at" DESC NULLS LAST,
    history."id" DESC
)
SELECT
  lead."id" AS "lead_id",
  latest."history_id",
  latest."from_status_code" AS "restore_status_code",
  latest."entered_at" AS "automatic_transition_at"
FROM "academy_leads" lead
JOIN latest_history latest ON latest."lead_id" = lead."id"
JOIN "academy_lead_statuses" restore_status
  ON restore_status."code" = latest."from_status_code"
 AND restore_status."is_active" = true
WHERE lead."status_code" = 'not_now'
  AND latest."to_status_code" = 'not_now'
  AND latest."comment" = 'Автоматический перенос: нет ответа 14+ дней'
  AND latest."from_status_code" IS NOT NULL
  AND latest."from_status_code" <> 'not_now';

CREATE UNIQUE INDEX academy_automatic_lead_stage_repairs_lead_unique
  ON academy_automatic_lead_stage_repairs ("lead_id");

UPDATE "academy_tasks" task
SET "status" = 'done',
    "completed_at" = COALESCE(task."completed_at", NOW()),
    "description" = CONCAT_WS(
      E'\n',
      NULLIF(task."description", ''),
      'Закрыто автоматически: ошибочный перенос лида отменён.'
    ),
    "updated_at" = NOW()
FROM academy_automatic_lead_stage_repairs repair
WHERE task."entity_type" = 'lead'
  AND task."entity_id" = repair."lead_id"
  AND task."title" = 'Лид автоматически перенесён в тёплую базу'
  AND task."created_at" >= repair."automatic_transition_at" - interval '1 minute'
  AND task."status" <> 'done';

UPDATE "academy_notification_outbox" outbox
SET "status" = 'cancelled',
    "error_message" = 'Отменено: ошибочный автоматический перенос лида восстановлен.',
    "updated_at" = NOW()
FROM academy_automatic_lead_stage_repairs repair
WHERE outbox."entity_type" = 'lead'
  AND outbox."entity_id" = repair."lead_id"
  AND outbox."created_at" >= repair."automatic_transition_at" - interval '1 minute'
  AND outbox."status" IN ('pending', 'processing')
  AND outbox."message" IN (
    '01 Academy: результат недели и новые проекты учеников. Хотите прийти на демо?',
    '01 Academy приглашает на демо-урок. Подберём курс по возрасту.',
    'Специальное предложение 01 Academy на этот месяц.'
  );

UPDATE "academy_leads" lead
SET "status_code" = repair."restore_status_code",
    "warm_moved_at" = NULL,
    "warm_reason" = NULL,
    "updated_at" = NOW()
FROM academy_automatic_lead_stage_repairs repair
WHERE lead."id" = repair."lead_id"
  AND lead."status_code" = 'not_now';

INSERT INTO "academy_lead_stage_history" (
  "lead_id",
  "from_status_code",
  "to_status_code",
  "changed_by",
  "comment"
)
SELECT
  repair."lead_id",
  'not_now',
  repair."restore_status_code",
  NULL,
  'Автоматическое восстановление: отменён ошибочный перенос по неактивности'
FROM academy_automatic_lead_stage_repairs repair;

INSERT INTO "academy_integration_logs" (
  "provider",
  "direction",
  "status",
  "payload",
  "retry_count"
)
SELECT
  'academy_automation',
  'internal',
  'repaired',
  jsonb_build_object(
    'reason', 'disabled_unsafe_stale_lead_transition',
    'restoredLeadCount', COUNT(*)
  ),
  0
FROM academy_automatic_lead_stage_repairs;
