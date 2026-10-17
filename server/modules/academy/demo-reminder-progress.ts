/** Shared participant read projection; it never changes or creates reminder work. */
export const demoReminderProgressJoinSql = (nowSql = 'CURRENT_TIMESTAMP') => `LEFT JOIN LATERAL (
  WITH context AS MATERIALIZED (
    SELECT voice_reminder_contact_phone(progress_student.id) AS phone,
      voice_reminder_contact_language(progress_student.id) AS language,
      voice_reminder_contact_language_revision(progress_student.id) AS language_revision,
      settings.enabled,settings.day_before_enabled,settings.day_before_start_time,settings.day_before_end_time,
      settings.allowed_start_time,settings.allowed_end_time
    FROM academy_students progress_student
    LEFT JOIN academy_leads progress_lead ON progress_lead.id=progress_student.lead_id
    LEFT JOIN voice_reminder_settings settings ON settings.id=1
    WHERE progress_student.id=participant.student_id
      AND (progress_student.lead_id IS NULL OR (progress_lead.id IS NOT NULL AND progress_lead.is_archived=false))
  )
  SELECT COALESCE(latest.progress_status, CASE
    WHEN demo.status='cancelled' OR participant.status='cancelled' THEN 'cancelled'
    WHEN demo.status<>'scheduled' OR demo.scheduled_at AT TIME ZONE 'UTC'<=${nowSql}
      OR participant.status NOT IN ('invited','confirmed') THEN 'not_started'
    WHEN context.phone IS NULL THEN 'no_phone'
    WHEN NOT COALESCE(context.enabled,false) THEN 'disabled'
    ELSE 'not_started' END) AS progress_status
  FROM context
  LEFT JOIN LATERAL (
    WITH candidates AS MATERIALIZED (
      SELECT job.id,job.status,job.no_response_count,job.lease_until,job.due_at,
        receipt.last_attempt_at,receipt.live_call,
        COALESCE(receipt.last_attempt_at IS NOT NULL AND job.phone=context.phone AND (
          (job.delivery_lesson_revision=demo.voice_response_revision
            AND job.delivery_participant_revision=participant.voice_response_revision)
          OR (job.delivery_lesson_revision IS NULL AND job.delivery_participant_revision IS NULL
            AND job.lesson_revision=demo.voice_reminder_revision
            AND job.participant_revision=participant.voice_reminder_revision
            AND job.language=context.language AND job.language_revision=context.language_revision)),false) AS attempted,
        (job.status='failed' AND job.lesson_revision=demo.voice_reminder_revision
          AND job.participant_revision=participant.voice_reminder_revision
          AND job.language=context.language AND job.language_revision=context.language_revision) AS current_failure,
        (job.status IN ('waiting','calling') AND context.enabled
          AND (job.reminder_kind='same_day' OR context.day_before_enabled)
          AND context.phone IS NOT NULL AND demo.status='scheduled'
          AND participant.status IN ('invited','confirmed')
          AND job.lesson_revision=demo.voice_reminder_revision
          AND job.participant_revision=participant.voice_reminder_revision
          AND job.language=context.language AND job.language_revision=context.language_revision
          AND GREATEST(job.due_at,COALESCE(job.not_before_at,job.due_at),${nowSql},deadline.begins_at)<deadline.ends_at
          AND (job.status<>'calling' OR job.lease_until>${nowSql})) AS pending
      FROM voice_reminder_jobs job
      CROSS JOIN LATERAL (SELECT
        CASE WHEN job.reminder_kind='day_before'
          THEN ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date-1+context.day_before_start_time::time) AT TIME ZONE 'Asia/Tashkent'
          ELSE ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date+context.allowed_start_time::time) AT TIME ZONE 'Asia/Tashkent' END AS begins_at,
        LEAST(job.scheduled_at, CASE WHEN job.reminder_kind='day_before'
          THEN ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date-1+context.day_before_end_time::time) AT TIME ZONE 'Asia/Tashkent'
          ELSE ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date+context.allowed_end_time::time) AT TIME ZONE 'Asia/Tashkent' END) AS ends_at) deadline
      LEFT JOIN LATERAL (
        SELECT MAX(attempt.started_at) AS last_attempt_at,
          COALESCE(bool_or(attempt.completed_at IS NULL AND attempt.termination_confirmed_at IS NULL),false) AS live_call
        FROM voice_reminder_call_attempts attempt
        WHERE attempt.job_id=job.id AND attempt.phone=context.phone AND attempt.started_at<=${nowSql}
      ) receipt ON true
      WHERE job.demo_lesson_id=demo.id AND job.participant_id=participant.id
        AND job.scheduled_at=demo.scheduled_at AT TIME ZONE 'UTC'
        AND (job.phone IS NULL OR job.phone=context.phone)
    )
    SELECT CASE
      WHEN attempted AND status='calling' AND lease_until>${nowSql} AND live_call THEN 'calling'
      WHEN attempted THEN CASE
        WHEN status IN ('played','delivered_no_response') THEN 'played'
        WHEN status='waiting' AND pending THEN 'retry'
        WHEN no_response_count>0 THEN 'played'
        WHEN status='waiting' THEN 'unanswered'
        WHEN status='calling' AND pending THEN 'retry'
        WHEN status='calling' THEN 'failed'
        ELSE status END
      WHEN current_failure THEN 'failed'
      ELSE 'waiting' END AS progress_status
    FROM candidates WHERE attempted OR pending OR current_failure
    ORDER BY (attempted AND status='calling' AND lease_until>${nowSql} AND live_call) DESC,
      attempted DESC,last_attempt_at DESC NULLS LAST,current_failure DESC,due_at,id DESC LIMIT 1
  ) latest ON true
) reminder_progress ON true`;
