import { query, type Row } from './academy-core';

export const readLeadCallHistory = async (leadId: number): Promise<Row[]> => {
  const [managerCalls,reminderCalls] = await Promise.all([
    query(`SELECT call.id, call.direction, call.status, call.phone,
      call.started_at,call.answered_at,call.ended_at,call.duration_seconds,call.talk_seconds,call.hangup_cause,
      call.user_id,employee.full_name AS user_name,call.note,call.note_updated_at,
      call.note_author_id,note_author.full_name AS note_author_name,
      (NULLIF(BTRIM(call.recording_url),'') IS NOT NULL OR call.talk_seconds>0) AS has_recording,
      'manager'::text AS source
      FROM telephony_calls call LEFT JOIN users employee ON employee.id=call.user_id
      LEFT JOIN users note_author ON note_author.id=call.note_author_id
      WHERE call.lead_id=$1 OR (call.contact_type='lead' AND call.contact_id=$1)
      ORDER BY call.started_at DESC`, [leadId]),
    query(`SELECT attempt.call_id::text AS id,attempt.call_id::text AS voice_reminder_call_id,
      'voice_reminder'::text AS source,'outgoing'::text AS direction,detail.status,attempt.phone,
      attempt.started_at,detail.answered_at,detail.ended_at,detail.duration_seconds,detail.talk_seconds,
      detail.hangup_cause,NULL::integer AS user_id,NULL::text AS user_name,
      NULL::text AS note,NULL::integer AS note_author_id,NULL::text AS note_author_name,NULL::timestamptz AS note_updated_at,
      detail.reminder_outcome,detail.reminder_response,
      (detail.recording_storage_key IS NOT NULL OR detail.recording_url IS NOT NULL OR detail.answered_at IS NOT NULL
        OR detail.reminder_response IS NOT NULL) AS has_recording
      FROM voice_reminder_call_details detail JOIN voice_reminder_call_attempts attempt ON attempt.call_id=detail.call_id
      WHERE detail.lead_id=$1 ORDER BY attempt.started_at DESC,attempt.call_id`, [leadId]),
  ]);
  return [...managerCalls,...reminderCalls].sort((left,right) =>
    new Date(right.startedAt).getTime()-new Date(left.startedAt).getTime() || String(right.id).localeCompare(String(left.id)));
};
