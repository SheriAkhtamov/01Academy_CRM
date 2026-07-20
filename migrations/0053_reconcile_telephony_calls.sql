DO $$
DECLARE
  duplicate_call RECORD;
BEGIN
  FOR duplicate_call IN
    SELECT
      client_row.id AS keep_id,
      provider_row.id AS duplicate_id,
      provider_row.provider_call_id,
      provider_row.user_id,
      provider_row.extension,
      provider_row.status,
      provider_row.started_at,
      provider_row.ended_at,
      provider_row.duration_seconds,
      provider_row.talk_seconds,
      provider_row.hangup_cause,
      provider_row.recording_url,
      provider_row.metadata
    FROM telephony_calls client_row
    JOIN telephony_calls provider_row
      ON provider_row.provider_call_id = client_row.client_call_id
     AND provider_row.id <> client_row.id
  LOOP
    UPDATE telephony_calls
    SET provider_call_id = NULL
    WHERE id = duplicate_call.duplicate_id;

    UPDATE telephony_calls
    SET provider_call_id = duplicate_call.provider_call_id,
        user_id = COALESCE(user_id, duplicate_call.user_id),
        extension = COALESCE(extension, duplicate_call.extension),
        status = CASE
          WHEN duplicate_call.status IN ('ended', 'failed', 'declined', 'missed')
            THEN duplicate_call.status
          ELSE status
        END,
        started_at = LEAST(started_at, duplicate_call.started_at),
        ended_at = COALESCE(duplicate_call.ended_at, ended_at),
        duration_seconds = GREATEST(duration_seconds, duplicate_call.duration_seconds),
        talk_seconds = GREATEST(talk_seconds, duplicate_call.talk_seconds),
        hangup_cause = COALESCE(duplicate_call.hangup_cause, hangup_cause),
        recording_url = COALESCE(duplicate_call.recording_url, recording_url),
        metadata = metadata || duplicate_call.metadata,
        updated_at = NOW()
    WHERE id = duplicate_call.keep_id;

    DELETE FROM telephony_calls
    WHERE id = duplicate_call.duplicate_id;
  END LOOP;
END $$;
