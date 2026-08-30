import type { Pool, PoolClient } from 'pg';
import { hasLeadershipAccess, type ModuleAccessSource } from '@shared/academy';
import { pool } from '../db';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type TelephonyNotificationViewer = {
  id: number;
  module?: string | null;
  modules?: readonly string[] | null;
};

export type MissedCallUnreadSummary = {
  count: number;
};

export const buildMissedIncomingCallSql = (callAlias: string) => `(
  ${callAlias}.direction = 'incoming'
  AND ${callAlias}.talk_seconds = 0
  AND ${callAlias}.status IN ('missed', 'failed', 'declined')
)`;

export const MISSED_INCOMING_CALL_SQL = buildMissedIncomingCallSql('call');

/**
 * A missed call stays actionable until the team places any later outgoing call
 * to the same normalized number. Phone values enter this table through
 * normalizeOnlinePbxPhone, and the existing (phone, started_at) index makes the
 * callback lookup cheap without a separate mutable read cursor.
 */
export const buildUnresolvedMissedCallSql = (callAlias: string) => `(
  ${buildMissedIncomingCallSql(callAlias)}
  AND NOT EXISTS (
    SELECT 1
    FROM telephony_calls callback
    WHERE callback.direction = 'outgoing'
      AND callback.phone = ${callAlias}.phone
      AND (callback.started_at, callback.id) > (${callAlias}.started_at, ${callAlias}.id)
  )
)`;

export const buildTelephonyCallVisibilitySql = (actorParameter: string) => `(
  call.user_id = ${actorParameter}
  OR lead.manager_id = ${actorParameter}
  OR (lead.id IS NOT NULL AND lead.manager_id IS NULL)
)`;

const visibilityCondition = (viewer: TelephonyNotificationViewer) => (
  hasLeadershipAccess(viewer as ModuleAccessSource)
    ? 'TRUE'
    : buildTelephonyCallVisibilitySql('$1')
);

export const getMissedCallUnreadSummary = async (
  viewer: TelephonyNotificationViewer,
  client: Queryable = pool,
): Promise<MissedCallUnreadSummary> => {
  const result = await client.query<{
    count: number | string;
  }>(
    `SELECT COUNT(*)::int AS count
     FROM telephony_calls call
     LEFT JOIN academy_leads lead ON lead.id = call.lead_id
     WHERE ${buildUnresolvedMissedCallSql('call')}
       AND ${visibilityCondition(viewer)}`,
    hasLeadershipAccess(viewer as ModuleAccessSource) ? [] : [viewer.id],
  );

  return {
    count: Number(result.rows[0]?.count ?? 0),
  };
};

export const getUnreadMissedCallCount = async (
  viewer: TelephonyNotificationViewer,
  client: Queryable = pool,
): Promise<number> => (
  await getMissedCallUnreadSummary(viewer, client)
).count;
