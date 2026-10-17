import { callJournalQuerySchema } from '@shared/contracts/call-journal';
import { DEFAULT_ACADEMY_TIME_ZONE } from '@shared/scheduling';
import { hasLeadershipAccess } from '@shared/academy';
import { getZonedDateOnlyRange } from '../lib/academy-time';
import type { TelephonyNotificationViewer } from './telephony-notifications';
import { buildTelephonyHistoryRowsSql, telephonyHistoryPublicColumns, telephonyHistoryPublicJoins } from './telephony-call-read-model';

export const buildCallJournalQuery = (viewer: TelephonyNotificationViewer, input: unknown) => {
  const parsed = callJournalQuerySchema.safeParse(input);
  if (!parsed.success) throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  const filters = parsed.data;
  const params: unknown[] = [];
  const addParam = (value: unknown) => `$${params.push(value)}`;
  const actorParameter = hasLeadershipAccess(viewer) ? '$1' : addParam(viewer.id);
  const employeeParameter = !['all', 'unassigned'].includes(filters.userId) ? addParam(Number(filters.userId)) : undefined;
  const rowsSql = buildTelephonyHistoryRowsSql(viewer, {
    actorParameter, employeeParameter, unassigned: filters.userId === 'unassigned',
  });
  const conditions = ['TRUE'];
  if (filters.direction !== 'all') conditions.push(`call.direction = ${addParam(filters.direction)}`);
  if (filters.status === 'missed') conditions.push('call.is_missed');
  else if (filters.status === 'callback') conditions.push('call.requires_callback');
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
    conditions.push(`call.started_at >= ${addParam(start.toISOString())}::timestamptz`);
  }
  if (filters.to) {
    const { end } = getZonedDateOnlyRange(new Date(`${filters.to}T00:00:00Z`), DEFAULT_ACADEMY_TIME_ZONE);
    conditions.push(`call.started_at < ${addParam(end.toISOString())}::timestamptz`);
  }
  const limitParam = addParam(filters.limit);
  const pageParam = addParam(filters.page);
  const effectivePage = `LEAST(${pageParam}, GREATEST(CEIL(summary.total::numeric / ${limitParam})::int, 1))`;
  const sql = `WITH call_rows AS (${rowsSql}), filtered_calls AS MATERIALIZED (
    SELECT ${telephonyHistoryPublicColumns},call.is_missed AS "_isMissed",call.is_answered AS "_isAnswered",
      call.sort_number AS "_sortNumber",call.sort_key AS "_sortKey"
    ${telephonyHistoryPublicJoins}
    WHERE ${conditions.join(' AND ')}
  ), summary AS (
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "_isMissed")::int AS missed,
      COUNT(*) FILTER (WHERE "_isAnswered")::int AS answered,
      COALESCE(SUM("talkSeconds"), 0)::double precision AS "talkSeconds" FROM filtered_calls
  ), page_calls AS (
    SELECT * FROM filtered_calls ORDER BY "startedAt" DESC,source,"_sortNumber" DESC NULLS LAST,"_sortKey" DESC
    LIMIT ${limitParam} OFFSET (SELECT (${effectivePage} - 1) * ${limitParam} FROM summary)
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(item) - ARRAY['_isMissed','_isAnswered','_sortNumber','_sortKey']
      ORDER BY item."startedAt" DESC,item.source,item."_sortNumber" DESC NULLS LAST,item."_sortKey" DESC) FROM page_calls item), '[]'::jsonb) AS items,
    ${effectivePage} AS page, ${limitParam}::int AS limit, summary.total,
    jsonb_build_object('missed', summary.missed, 'answered', summary.answered, 'talkSeconds', summary."talkSeconds") AS summary FROM summary`;
  return { sql, params };
};
