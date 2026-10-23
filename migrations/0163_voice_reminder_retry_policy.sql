-- Separate unanswered-call retries from the single delivered-question follow-up.
-- Existing terminal jobs remain terminal; deployment never starts a new campaign.
ALTER TABLE voice_reminder_settings
  ADD COLUMN same_day_retry_minutes integer NOT NULL DEFAULT 30
    CHECK (same_day_retry_minutes BETWEEN 1 AND 60),
  ADD COLUMN day_before_max_attempts integer NOT NULL DEFAULT 3
    CHECK (day_before_max_attempts BETWEEN 1 AND 5),
  ADD COLUMN day_before_retry_minutes integer NOT NULL DEFAULT 60
    CHECK (day_before_retry_minutes BETWEEN 1 AND 60);

-- Pending retries created under the old shared interval must respect the new
-- minimum spacing, without reopening any completed job or moving the follow-up.
UPDATE voice_reminder_jobs job SET due_at=job.last_call_at+
    (CASE WHEN job.reminder_kind='day_before' THEN settings.day_before_retry_minutes ELSE settings.same_day_retry_minutes END*interval '1 minute')
  FROM voice_reminder_settings settings
  WHERE settings.id=1 AND job.status='waiting' AND job.retry_phase='primary'
    AND job.attempts>0 AND job.last_call_at IS NOT NULL AND job.due_at<job.last_call_at+
      (CASE WHEN job.reminder_kind='day_before' THEN settings.day_before_retry_minutes ELSE settings.same_day_retry_minutes END*interval '1 minute');

ALTER TABLE voice_reminder_call_details ADD COLUMN reminder_reason varchar(30)
  CHECK (reminder_reason IN ('no_answer','line_busy','rejected','not_connected','interrupted','technical_error'));
ALTER TABLE voice_reminder_test_calls ADD COLUMN reminder_reason varchar(30)
  CHECK (reminder_reason IN ('no_answer','line_busy','rejected','not_connected','interrupted','technical_error'));

-- Only facts already established by a completed, unanswered call are recoverable
-- from old receipts. A past answered failure does not prove partial playback.
UPDATE voice_reminder_call_details detail SET reminder_reason=CASE
    WHEN detail.hangup_cause='USER_BUSY' THEN 'line_busy'
    WHEN detail.hangup_cause='CALL_REJECTED' THEN 'rejected'
    WHEN detail.hangup_cause IN ('NORMAL_CLEARING','NORMAL_UNSPECIFIED') THEN 'not_connected'
    WHEN detail.reminder_outcome='unanswered' THEN 'no_answer' END
  FROM voice_reminder_call_attempts attempt
  WHERE attempt.call_id=detail.call_id AND attempt.termination_confirmed_at IS NOT NULL
    AND detail.answered_at IS NULL AND detail.talk_seconds=0 AND detail.reminder_response IS NULL
    AND detail.reminder_outcome IN ('unanswered','failed');
