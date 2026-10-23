/** A public, read-only history for the current invitation; never expose provider data or telephone numbers. */
export const demoReminderDetailsJoinSql = (nowSql: string) => `LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'kind',job.reminder_kind,'status',job.status,
    'attemptLimit',CASE WHEN job.reminder_kind='day_before' THEN context.day_before_max_attempts ELSE context.max_attempts END,
    'responseRetry',job.retry_phase='response_retry',
    'nextAttemptAt',CASE WHEN job.status='waiting' AND context.enabled
      AND (job.retry_phase='response_retry' OR job.attempts<CASE WHEN job.reminder_kind='day_before' THEN context.day_before_max_attempts ELSE context.max_attempts END)
      AND (job.reminder_kind='same_day' OR context.day_before_enabled)
      AND demo.status='scheduled' AND participant.status IN ('invited','confirmed')
      AND clock.next_at<clock.ends_at THEN clock.next_at END,
    'calls',COALESCE(history.calls,'[]'::jsonb)
  ) ORDER BY job.reminder_kind,job.id) AS runs
  FROM voice_reminder_jobs job
  CROSS JOIN LATERAL (SELECT
    GREATEST(job.due_at,COALESCE(job.not_before_at,job.due_at),${nowSql},
      CASE WHEN job.reminder_kind='day_before'
        THEN ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date-1+context.day_before_start_time::time) AT TIME ZONE 'Asia/Tashkent'
        ELSE ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date+context.allowed_start_time::time) AT TIME ZONE 'Asia/Tashkent' END) AS next_at,
    LEAST(job.scheduled_at,CASE WHEN job.reminder_kind='day_before'
      THEN ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date-1+context.day_before_end_time::time) AT TIME ZONE 'Asia/Tashkent'
      ELSE ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date+context.allowed_end_time::time) AT TIME ZONE 'Asia/Tashkent' END) AS ends_at
  ) clock
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'startedAt',attempt.started_at,'answeredAt',detail.answered_at,
      'endedAt',COALESCE(detail.ended_at,attempt.completed_at,attempt.termination_confirmed_at),
      'talkSeconds',COALESCE(detail.talk_seconds,0),'outcome',detail.reminder_outcome,
      'reason',detail.reminder_reason,'response',detail.reminder_response,
      'terminationConfirmed',attempt.termination_confirmed_at IS NOT NULL,
      'causeUnspecified',COALESCE(detail.hangup_cause='NORMAL_UNSPECIFIED',false),
      'responseRetry',COALESCE(job.retry_phase='response_retry' AND attempt.started_at>job.delivered_at,false)
    ) ORDER BY attempt.started_at,attempt.call_id) AS calls
    FROM voice_reminder_call_attempts attempt
    LEFT JOIN voice_reminder_call_details detail ON detail.call_id=attempt.call_id
    WHERE attempt.job_id=job.id AND attempt.phone=context.phone AND attempt.started_at<=${nowSql}
  ) history ON true
  WHERE job.demo_lesson_id=demo.id AND job.participant_id=participant.id
    AND job.scheduled_at=demo.scheduled_at AT TIME ZONE 'UTC'
    AND (job.phone IS NULL OR job.phone=context.phone)
    AND ((job.delivery_lesson_revision=demo.voice_response_revision
        AND job.delivery_participant_revision=participant.voice_response_revision)
      OR (job.delivery_lesson_revision IS NULL AND job.delivery_participant_revision IS NULL
        AND job.lesson_revision=demo.voice_reminder_revision AND job.participant_revision=participant.voice_reminder_revision
        AND job.language=context.language AND job.language_revision=context.language_revision))
) reminder_details ON true`;
