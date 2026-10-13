import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type ProviderChannelSnapshot = {
  known: boolean;
  occupiedChannels: number;
  busyExtensions: readonly string[];
};
export type ChannelReservation = { id: string; extension: string; clientCallId: string };
export type ChannelReservationInput = {
  owner: 'manager' | 'robot';
  userId?: number;
  extensions: readonly string[];
  clientCallId: string;
  phone: string | null;
};

const LOCK = 'onlinepbx:shared-external-channels';
const LEASE_SECONDS = 90;

/** The same transaction and mutex are used before manager and robot dial. */
export class TelephonyChannelReservations {
  constructor(
    private readonly database: Pick<Pool, 'connect' | 'query'>,
    private readonly snapshot: () => Promise<ProviderChannelSnapshot>,
  ) {}

  async enabled(): Promise<boolean> {
    const result = await this.database.query<{ enabled: boolean }>('SELECT enabled FROM voice_reminder_settings WHERE id = 1');
    return Boolean(result.rows[0]?.enabled);
  }

  private async locked<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async acquire(input: ChannelReservationInput): Promise<ChannelReservation | null> {
    // An unknown provider view is not evidence that a line is free. Do not hold
    // a database transaction while a network status request is in flight.
    const provider: ProviderChannelSnapshot = await this.snapshot().catch(() => ({ known: false, occupiedChannels: 0, busyExtensions: [] }));
    if (!provider.known || !Number.isInteger(provider.occupiedChannels) || provider.occupiedChannels < 0) return null;
    return this.locked(async client => {
      await client.query('DELETE FROM telephony_line_reservations WHERE lease_until <= now()');
      const existing = await client.query<ChannelReservation & { phone: string }>(
        `SELECT id, extension, client_call_id AS "clientCallId", phone
         FROM telephony_line_reservations ORDER BY created_at`,
      );
      const retry = existing.rows.find(row => row.clientCallId === input.clientCallId);
      if (retry) {
        const owned = await client.query(
          `SELECT 1 FROM telephony_line_reservations WHERE id = $1 AND owner_type = $2
             AND owner_user_id IS NOT DISTINCT FROM $3::integer`, [retry.id, input.owner, input.userId ?? null],
        );
        return owned.rowCount ? retry : null;
      }
      if (input.phone && existing.rows.some(row => row.phone === input.phone)) return null;
      const pending = existing.rows.filter(row => !provider.busyExtensions.includes(row.extension)).length;
      // Provider webhooks include incoming calls before they reach a user.
      // Counting their distinct provider IDs is conservative when an old row
      // has not been reconciled yet; it can postpone a robot, never add a line.
      const active = await client.query<{ count: string }>(
        `SELECT count(DISTINCT COALESCE(provider_call_id, client_call_id))::text AS count
         FROM telephony_calls WHERE ended_at IS NULL AND status IN ('dialing','ringing','connected')`,
      );
      const occupied = Math.max(provider.occupiedChannels, Number(active.rows[0]?.count ?? 0));
      if (Math.max(existing.rows.length, occupied + pending) >= 2) return null;
      const extension = input.extensions.find(value => !provider.busyExtensions.includes(value)
        && !existing.rows.some(row => row.extension === value));
      if (!extension) return null;
      const reservation = { id: randomUUID(), extension, clientCallId: input.clientCallId };
      await client.query(
        `INSERT INTO telephony_line_reservations
         (id, extension, owner_type, owner_user_id, client_call_id, phone, lease_until)
         VALUES ($1,$2,$3,$4,$5,$6,now() + make_interval(secs => $7))`,
        [reservation.id, extension, input.owner, input.userId ?? null, input.clientCallId, input.phone, LEASE_SECONDS],
      );
      return reservation;
    });
  }

  async renew(id: string, owner: 'manager' | 'robot', userId?: number): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE telephony_line_reservations SET lease_until = now() + make_interval(secs => $4)
       WHERE id = $1 AND owner_type = $2 AND owner_user_id IS NOT DISTINCT FROM $3::integer AND lease_until > now()`,
      [id, owner, userId ?? null, LEASE_SECONDS],
    );
    return Boolean(result.rowCount);
  }

  async bind(id: string, input: { phone: string; jobId: number; clientCallId: string }): Promise<boolean> {
    return this.locked(async client => {
      const duplicate = await client.query(
        'SELECT 1 FROM telephony_line_reservations WHERE id <> $1 AND phone = $2 AND lease_until > now()', [id, input.phone],
      );
      if (duplicate.rowCount) return false;
      const result = await client.query(
        `UPDATE telephony_line_reservations SET phone = $2, job_id = $3, client_call_id = $4
         WHERE id = $1 AND owner_type = 'robot' AND lease_until > now()`,
        [id, input.phone, input.jobId, input.clientCallId],
      );
      return Boolean(result.rowCount);
    });
  }

  async release(id: string, owner: 'manager' | 'robot', userId?: number): Promise<void> {
    await this.database.query(
      `DELETE FROM telephony_line_reservations WHERE id = $1 AND owner_type = $2
       AND owner_user_id IS NOT DISTINCT FROM $3::integer`, [id, owner, userId ?? null],
    );
  }
}
