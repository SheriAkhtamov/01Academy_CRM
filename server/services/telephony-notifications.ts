import type { Pool, PoolClient } from 'pg';
import { hasLeadershipAccess, type WorkspaceAccessSource } from '@shared/academy';
import { pool } from '../db';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type TelephonyNotificationViewer = {
  id: number;
  workspace?: string | null;
  workspaces?: readonly string[] | null;
};

export const MISSED_INCOMING_CALL_SQL = `(
  call.direction = 'incoming'
  AND call.talk_seconds = 0
  AND call.status IN ('missed', 'failed', 'declined')
)`;

export const buildTelephonyCallVisibilitySql = (actorParameter: string) => `(
  call.user_id = ${actorParameter}
  OR lead.manager_id = ${actorParameter}
  OR (lead.id IS NOT NULL AND lead.manager_id IS NULL)
)`;

const visibilityCondition = (viewer: TelephonyNotificationViewer) => (
  hasLeadershipAccess(viewer as WorkspaceAccessSource)
    ? 'TRUE'
    : buildTelephonyCallVisibilitySql('$1')
);

export const getUnreadMissedCallCount = async (
  viewer: TelephonyNotificationViewer,
  client: Queryable = pool,
): Promise<number> => {
  const result = await client.query<{ count: number | string }>(
    `WITH inserted_state AS (
       INSERT INTO telephony_missed_call_states (user_id, last_seen_call_id)
       SELECT $1, COALESCE(MAX(id), 0)
       FROM telephony_calls
       ON CONFLICT (user_id) DO NOTHING
       RETURNING last_seen_call_id
     ),
     current_state AS (
       SELECT last_seen_call_id FROM inserted_state
       UNION ALL
       SELECT last_seen_call_id
       FROM telephony_missed_call_states
       WHERE user_id = $1
       LIMIT 1
     )
     SELECT COUNT(*)::int AS count
     FROM telephony_calls call
     LEFT JOIN academy_leads lead ON lead.id = call.lead_id
     CROSS JOIN current_state state
     WHERE ${MISSED_INCOMING_CALL_SQL}
       AND call.id > state.last_seen_call_id
       AND ${visibilityCondition(viewer)}`,
    [viewer.id],
  );

  return Number(result.rows[0]?.count ?? 0);
};

export const markMissedCallsSeen = async (
  viewer: TelephonyNotificationViewer,
  client: Queryable = pool,
): Promise<number> => {
  const result = await client.query<{ lastSeenCallId: number | string }>(
    `WITH latest_visible_call AS (
       SELECT COALESCE(MAX(call.id), 0)::int AS last_seen_call_id
       FROM telephony_calls call
       LEFT JOIN academy_leads lead ON lead.id = call.lead_id
       WHERE ${MISSED_INCOMING_CALL_SQL}
         AND ${visibilityCondition(viewer)}
     )
     INSERT INTO telephony_missed_call_states (
       user_id,
       last_seen_call_id,
       updated_at
     )
     SELECT $1, latest_visible_call.last_seen_call_id, NOW()
     FROM latest_visible_call
     ON CONFLICT (user_id) DO UPDATE
     SET last_seen_call_id = GREATEST(
           telephony_missed_call_states.last_seen_call_id,
           EXCLUDED.last_seen_call_id
         ),
         updated_at = NOW()
     RETURNING last_seen_call_id AS "lastSeenCallId"`,
    [viewer.id],
  );

  return Number(result.rows[0]?.lastSeenCallId ?? 0);
};
