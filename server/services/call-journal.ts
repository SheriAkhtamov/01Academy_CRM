import { callJournalQuerySchema } from '@shared/contracts/call-journal';
import { DEFAULT_ACADEMY_TIME_ZONE } from '@shared/scheduling';
import { hasLeadershipAccess } from '@shared/academy';
import { getZonedDateOnlyRange } from '../lib/academy-time';
import { buildMissedIncomingCallSql, buildPersonalCallHistorySql, buildUnresolvedMissedCallSql, telephonyCallVisibilityCondition, type TelephonyNotificationViewer } from './telephony-notifications';

export const buildCallJournalQuery = (viewer: TelephonyNotificationViewer, input: unknown) => {
  const parsed = callJournalQuerySchema.safeParse(input);
  if (!parsed.success) throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  const filters = parsed.data;
  const params: unknown[] = [];
  const addParam = (value: unknown) => `$${params.push(value)}`;
  const conditions = [telephonyCallVisibilityCondition(viewer, hasLeadershipAccess(viewer) ? '$1' : addParam(viewer.id))];
  if (filters.userId === 'unassigned') conditions.push('call.user_id IS NULL');
  else if (filters.userId !== 'all') conditions.push(buildPersonalCallHistorySql(addParam(Number(filters.userId))));
  if (filters.direction !== 'all') conditions.push(`call.direction = ${addParam(filters.direction)}`);
  if (filters.status === 'missed') conditions.push(buildMissedIncomingCallSql('call'));
  else if (filters.status === 'callback') conditions.push(buildUnresolvedMissedCallSql('call'));
  else if (filters.status !== 'all') conditions.push(`call.status = ${addParam(filters.status)}`);
  if (filters.q) {
    const like = addParam(`%${filters.q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
    const phoneDigits = filters.q.replace(/\D/g, '');
    const phone = phoneDigits.length >= 3 && /^[+\d\s().-]+$/.test(filters.q) ? `OR REGEXP_REPLACE(call.phone, '[^0-9]', '', 'g') LIKE ${addParam(`%${phoneDigits}%`)}` : '';
    conditions.push(`(LOWER(call.phone) LIKE ${like} ${phone}
      OR LOWER(COALESCE(call.contact_name, '')) LIKE ${like}
      OR LOWER(COALESCE(lead.contact_name, '')) LIKE ${like}
      OR LOWER(COALESCE(lead.student_name, '')) LIKE ${like}
      OR LOWER(COALESCE(employee.full_name, '')) LIKE ${like}
      OR EXISTS (SELECT 1 FROM academy_students pupil WHERE pupil.lead_id = lead.id AND LOWER(pupil.student_name) LIKE ${like}))`);
  }
  if (filters.from) {
    const { start } = getZonedDateOnlyRange(new Date(`${filters.from}T00:00:00Z`), DEFAULT_ACADEMY_TIME_ZONE);
    conditions.push(`call.started_at >= (${addParam(start.toISOString())}::timestamptz AT TIME ZONE 'UTC')`);
  }
  if (filters.to) {
    const { end } = getZonedDateOnlyRange(new Date(`${filters.to}T00:00:00Z`), DEFAULT_ACADEMY_TIME_ZONE);
    conditions.push(`call.started_at < (${addParam(end.toISOString())}::timestamptz AT TIME ZONE 'UTC')`);
  }
  const limitParam = addParam(filters.limit);
  const pageParam = addParam(filters.page);
  const effectivePage = `LEAST(${pageParam}, GREATEST(CEIL(summary.total::numeric / ${limitParam})::int, 1))`;
  const sql = `WITH filtered_calls AS MATERIALIZED (
    SELECT call.id, call.client_call_id AS "clientCallId", call.provider_call_id AS "providerCallId",
      call.user_id AS "userId", employee.full_name AS "userName", call.extension, call.direction, call.status, call.phone,
      call.lead_id AS "leadId", COALESCE(NULLIF(lead.student_name, ''), NULLIF(lead.contact_name, ''), call.contact_name) AS "leadName",
      lead.contact_name AS "contactName", lead.manager_id AS "managerId", manager.full_name AS "managerName",
      call.started_at AT TIME ZONE 'UTC' AS "startedAt", call.answered_at AT TIME ZONE 'UTC' AS "answeredAt",
      call.ended_at AT TIME ZONE 'UTC' AS "endedAt", call.duration_seconds AS "durationSeconds",
      call.talk_seconds AS "talkSeconds", call.hangup_cause AS "hangupCause", call.note,
      (NULLIF(BTRIM(call.recording_url), '') IS NOT NULL OR call.talk_seconds > 0) AS "hasRecording",
      ${buildUnresolvedMissedCallSql('call')} AS "requiresCallback", ${buildMissedIncomingCallSql('call')} AS "isMissed"
    FROM telephony_calls call
    LEFT JOIN users employee ON employee.id = call.user_id
    LEFT JOIN academy_leads lead ON lead.id = call.lead_id
    LEFT JOIN users manager ON manager.id = lead.manager_id
    WHERE ${conditions.join(' AND ')}
  ), summary AS (
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "isMissed")::int AS missed,
      COUNT(*) FILTER (WHERE "talkSeconds" > 0)::int AS answered,
      COALESCE(SUM("talkSeconds"), 0)::double precision AS "talkSeconds" FROM filtered_calls
  ), page_calls AS (
    SELECT * FROM filtered_calls ORDER BY "startedAt" DESC, id DESC
    LIMIT ${limitParam} OFFSET (SELECT (${effectivePage} - 1) * ${limitParam} FROM summary)
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(item) - 'isMissed' ORDER BY item."startedAt" DESC, item.id DESC) FROM page_calls item), '[]'::jsonb) AS items,
    ${effectivePage} AS page, ${limitParam}::int AS limit, summary.total,
    jsonb_build_object('missed', summary.missed, 'answered', summary.answered, 'talkSeconds', summary."talkSeconds") AS summary FROM summary`;
  return { sql, params };
};
