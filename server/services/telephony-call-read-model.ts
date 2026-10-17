import {
  buildMissedIncomingCallSql, buildPersonalCallHistorySql, buildUnresolvedMissedCallSql,
  telephonyCallVisibilityCondition, telephonyPersonalHistoryCondition, telephonyReminderHistoryCondition,
  type TelephonyNotificationViewer,
} from './telephony-notifications';

type HistoryScope = {
  actorParameter: string;
  personal?: boolean;
  employeeParameter?: string;
  unassigned?: boolean;
};

/** Both histories read this union; operational call tables and callback rules stay independent. */
export const buildTelephonyHistoryRowsSql = (viewer: TelephonyNotificationViewer, scope: HistoryScope) => {
  const managerConditions = [scope.personal
    ? telephonyPersonalHistoryCondition(viewer, scope.actorParameter)
    : telephonyCallVisibilityCondition(viewer, scope.actorParameter)];
  const reminderConditions = [telephonyReminderHistoryCondition(viewer, scope.actorParameter)];
  if (scope.employeeParameter) {
    managerConditions.push(buildPersonalCallHistorySql(scope.employeeParameter));
    reminderConditions.push(`lead.manager_id = ${scope.employeeParameter}`);
  } else if (scope.unassigned) {
    managerConditions.push('call.user_id IS NULL');
    reminderConditions.push('lead.manager_id IS NULL');
  }
  // JSONB keeps the public ID a number for a manager and a UUID string for a bot.
  // Native sort_number also preserves numeric ID ordering for simultaneous manager calls.
  return `SELECT to_jsonb(call.id) AS id,call.id AS sort_number,call.id::text AS sort_key,
      'manager'::text AS source,NULL::text AS voice_reminder_call_id,
      call.client_call_id,call.provider_call_id,call.user_id,call.extension,call.direction,call.status,call.phone,
      call.lead_id,call.contact_type,call.contact_id,call.contact_name,
      call.started_at AT TIME ZONE 'UTC' AS started_at,call.answered_at AT TIME ZONE 'UTC' AS answered_at,
      call.ended_at AT TIME ZONE 'UTC' AS ended_at,call.duration_seconds,call.talk_seconds,call.hangup_cause,call.note,
      (NULLIF(BTRIM(call.recording_url),'') IS NOT NULL OR call.talk_seconds>0) AS has_recording,
      NULL::text AS reminder_outcome,NULL::text AS reminder_response,
      ${buildUnresolvedMissedCallSql('call')} AS requires_callback,
      ${buildMissedIncomingCallSql('call')} AS is_missed,call.talk_seconds>0 AS is_answered
    FROM telephony_calls call LEFT JOIN academy_leads lead ON lead.id=call.lead_id
    WHERE ${managerConditions.join(' AND ')}
    UNION ALL
    SELECT to_jsonb(attempt.call_id::text),NULL::integer,attempt.call_id::text,
      'voice_reminder'::text,attempt.call_id::text,NULL::text,NULL::text,NULL::integer,NULL::text,
      'outgoing'::text,detail.status,attempt.phone,detail.lead_id,'lead'::text,detail.lead_id,lead.contact_name,
      attempt.started_at,detail.answered_at,detail.ended_at,detail.duration_seconds,detail.talk_seconds,
      detail.hangup_cause,NULL::text,
      (detail.recording_storage_key IS NOT NULL OR detail.recording_url IS NOT NULL
        OR detail.answered_at IS NOT NULL OR detail.reminder_response IS NOT NULL),
      detail.reminder_outcome,detail.reminder_response,FALSE,FALSE,
      (detail.talk_seconds>0 OR detail.answered_at IS NOT NULL OR detail.reminder_response IS NOT NULL)
    FROM voice_reminder_call_details detail JOIN voice_reminder_call_attempts attempt ON attempt.call_id=detail.call_id
    JOIN academy_leads lead ON lead.id=detail.lead_id
    WHERE ${reminderConditions.join(' AND ')}`;
};

export const telephonyHistoryPublicColumns = `call.id,call.source,call.voice_reminder_call_id AS "voiceReminderCallId",
  call.client_call_id AS "clientCallId",call.provider_call_id AS "providerCallId",
  call.user_id AS "userId",employee.full_name AS "userName",call.extension,call.direction,call.status,call.phone,
  call.contact_type AS "contactType",call.contact_id AS "contactId",
  COALESCE(NULLIF(lead.contact_name,''),call.contact_name) AS "contactName",call.lead_id AS "leadId",
  COALESCE(NULLIF(lead.student_name,''),NULLIF(lead.contact_name,''),call.contact_name) AS "leadName",
  lead.manager_id AS "managerId",manager.full_name AS "managerName",
  call.started_at AS "startedAt",call.answered_at AS "answeredAt",call.ended_at AS "endedAt",
  call.duration_seconds AS "durationSeconds",call.talk_seconds AS "talkSeconds",call.hangup_cause AS "hangupCause",
  call.note,call.has_recording AS "hasRecording",call.reminder_outcome AS "reminderOutcome",
  call.reminder_response AS "reminderResponse",call.requires_callback AS "requiresCallback"`;

export const telephonyHistoryPublicJoins = `FROM call_rows call
  LEFT JOIN users employee ON employee.id=call.user_id
  LEFT JOIN academy_leads lead ON lead.id=call.lead_id
  LEFT JOIN users manager ON manager.id=lead.manager_id`;

export const buildPersonalCallHistoryQuery = (
  viewer: TelephonyNotificationViewer,
  filter: 'all' | 'missed' | 'incoming' | 'outgoing',
  limit: number,
  offset: number,
) => {
  const params: unknown[] = [viewer.id];
  const condition = filter === 'missed' ? 'call.requires_callback'
    : filter === 'all' ? 'TRUE' : `call.direction = $${params.push(filter)}`;
  const limitParameter = `$${params.push(limit)}`;
  const offsetParameter = `$${params.push(offset)}`;
  const sql = `WITH call_rows AS (${buildTelephonyHistoryRowsSql(viewer, { actorParameter: '$1', personal: true })})
    SELECT ${telephonyHistoryPublicColumns} ${telephonyHistoryPublicJoins}
    WHERE ${condition}
    ORDER BY call.started_at DESC,call.source,call.sort_number DESC NULLS LAST,call.sort_key DESC
    LIMIT ${limitParameter} OFFSET ${offsetParameter}`;
  return { sql, params };
};
