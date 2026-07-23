UPDATE "academy_tasks" task
SET "status" = 'done',
    "completed_at" = COALESCE(task."completed_at", NOW()),
    "description" = CONCAT_WS(
      E'\n',
      NULLIF(task."description", ''),
      'Закрыто автоматически: ошибочный перенос лида отменён.'
    ),
    "updated_at" = NOW()
WHERE task."entity_type" = 'lead'
  AND task."title" = 'Лид автоматически перенесён в тёплую базу'
  AND task."status" <> 'done'
  AND EXISTS (
    SELECT 1
    FROM "academy_lead_stage_history" automatic_history
    WHERE automatic_history."lead_id" = task."entity_id"
      AND automatic_history."to_status_code" = 'not_now'
      AND automatic_history."comment" = 'Автоматический перенос: нет ответа 14+ дней'
      AND task."created_at" >= automatic_history."entered_at" - interval '1 minute'
  );

UPDATE "academy_notification_outbox" outbox
SET "status" = 'cancelled',
    "error_message" = 'Отменено: ошибочный автоматический перенос лида восстановлен.',
    "updated_at" = NOW()
WHERE outbox."entity_type" = 'lead'
  AND outbox."status" IN ('pending', 'processing')
  AND outbox."message" IN (
    '01 Academy: результат недели и новые проекты учеников. Хотите прийти на демо?',
    '01 Academy приглашает на демо-урок. Подберём курс по возрасту.',
    'Специальное предложение 01 Academy на этот месяц.'
  )
  AND EXISTS (
    SELECT 1
    FROM "academy_lead_stage_history" automatic_history
    WHERE automatic_history."lead_id" = outbox."entity_id"
      AND automatic_history."to_status_code" = 'not_now'
      AND automatic_history."comment" = 'Автоматический перенос: нет ответа 14+ дней'
      AND outbox."created_at" >= automatic_history."entered_at" - interval '1 minute'
  );
