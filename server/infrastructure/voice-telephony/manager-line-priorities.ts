import type { Pool, PoolClient } from 'pg';
import type { OwnTelephonyLineStatus } from '@shared/contracts/telephony-lines';

// Select only the manager's extension. A terminated receipt overrides a lease
// that its owner has not released yet; an unresolved receipt outlives any TTL.
const robotBlockerSql = `
  SELECT lease.client_call_id AS call_id,lease.id AS reservation_id,0 AS preference,lease.created_at AS started_at
  FROM telephony_line_reservations lease
  LEFT JOIN voice_reminder_call_attempts receipt ON receipt.call_id::text=lease.client_call_id AND receipt.extension=lease.extension
  WHERE lease.owner_type='robot' AND lease.extension=staff.online_pbx_extension
    AND lease.lease_until>clock_timestamp() AND receipt.termination_confirmed_at IS NULL
  UNION ALL
  SELECT attempt.call_id::text,NULL::uuid,1,attempt.started_at FROM voice_reminder_call_attempts attempt
  WHERE attempt.extension=staff.online_pbx_extension AND attempt.termination_confirmed_at IS NULL
  ORDER BY preference,started_at LIMIT 1`;

/** Mutations run under the shared external-channel transaction mutex. */
export class ManagerLinePriorities {
  async ownLineStatus(connection: Pick<Pool,'query'>, userId: number, extension: string, lockAssignment = false): Promise<OwnTelephonyLineStatus | null> {
    const row = (await connection.query<OwnTelephonyLineStatus>(`SELECT EXISTS(${robotBlockerSql}) AS "busyWithReminder"
      FROM users staff WHERE staff.id=$1 AND staff.is_active AND NOT staff.is_archived
        AND staff.online_pbx_extension=$2 ${lockAssignment ? 'FOR SHARE OF staff' : ''}`, [userId,extension])).rows[0];
    return row ?? null;
  }

  async refresh(client: PoolClient): Promise<void> {
    // A receipt's bookkeeping completion is not proof that the PBX has ended
    // the call. A missing receipt is safe only after its lease is gone/expired:
    // every robot INVITE is preceded by a receipt under this same mutex.
    await client.query(`UPDATE telephony_manager_line_priorities priority
      SET ended_at=GREATEST(proof.ended_at,priority.requested_at),
        priority_until=GREATEST(proof.ended_at,priority.requested_at)+interval '3 minutes'
      FROM (SELECT pending.extension, CASE
          WHEN attempt.termination_confirmed_at IS NOT NULL THEN attempt.termination_confirmed_at
          WHEN attempt.call_id IS NULL AND lease.id IS NULL THEN clock_timestamp()
          WHEN attempt.call_id IS NULL AND lease.lease_until<=clock_timestamp() THEN lease.lease_until
        END AS ended_at
        FROM telephony_manager_line_priorities pending
        LEFT JOIN voice_reminder_call_attempts attempt ON attempt.call_id::text=pending.blocking_client_call_id AND attempt.extension=pending.extension
        LEFT JOIN telephony_line_reservations lease ON lease.id=pending.blocking_reservation_id
          AND lease.owner_type='robot' AND lease.client_call_id=pending.blocking_client_call_id AND lease.extension=pending.extension
        WHERE pending.ended_at IS NULL) proof
      WHERE priority.extension=proof.extension AND priority.ended_at IS NULL AND proof.ended_at IS NOT NULL`);
  }

  async requestForBlockedManager(client: PoolClient, userId: number, extensions: readonly string[]): Promise<boolean> {
    const blocked = await client.query<{ extension: string; callId: string; reservationId: string | null }>(
      `SELECT staff.online_pbx_extension AS extension, blocker.call_id AS "callId",blocker.reservation_id AS "reservationId"
       FROM users staff
       CROSS JOIN LATERAL (${robotBlockerSql}) blocker
       WHERE staff.id=$1 AND staff.is_active AND NOT staff.is_archived
         AND staff.online_pbx_extension=ANY($2::text[]) FOR SHARE OF staff`, [userId,extensions],
    );
    const blocker = blocked.rows[0];
    if (!blocker) return false;
    // Retrying the same denied action must not reset a running cooldown or
    // replace the unresolved attempt that the demand was originally bound to.
    await client.query(`INSERT INTO telephony_manager_line_priorities
      (extension,requester_user_id,blocking_client_call_id,blocking_reservation_id)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(extension) DO UPDATE SET requester_user_id=EXCLUDED.requester_user_id,
        blocking_client_call_id=EXCLUDED.blocking_client_call_id,blocking_reservation_id=EXCLUDED.blocking_reservation_id,
        requested_at=clock_timestamp(),ended_at=NULL,priority_until=NULL
      WHERE telephony_manager_line_priorities.priority_until<=clock_timestamp()
        AND telephony_manager_line_priorities.blocking_client_call_id<>EXCLUDED.blocking_client_call_id`,
    [blocker.extension,userId,blocker.callId,blocker.reservationId]);
    await this.refresh(client);
    return true;
  }

  async blockedExtensions(client: PoolClient): Promise<Set<string>> {
    await this.refresh(client);
    const rows = await client.query<{ extension: string }>(`SELECT extension FROM telephony_manager_line_priorities
      WHERE ended_at IS NULL OR priority_until>clock_timestamp()`);
    return new Set(rows.rows.map(row => row.extension));
  }

  async preferOffline(client: PoolClient, extensions: readonly string[]): Promise<string[]> {
    const owners = await client.query<{ extension: string; online: boolean }>(`SELECT online_pbx_extension AS extension,
      bool_or(COALESCE(is_online,false)) AS online FROM users
      WHERE is_active AND NOT is_archived AND online_pbx_extension=ANY($1::text[])
      GROUP BY online_pbx_extension`, [extensions]);
    const online = new Set(owners.rows.filter(row => row.online).map(row => row.extension));
    return [...extensions].sort((left,right) => Number(online.has(left))-Number(online.has(right)));
  }
}
