import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type ProviderChannelSnapshot = {
  known: boolean;
  occupiedChannels: number;
  busyExtensions: readonly string[];
};
export type ChannelReservation = { id: string; extension: string; clientCallId: string };
type StoredReservation = ChannelReservation & { phone: string | null; authorizedAt: Date | null; alive: boolean };
type LockedCapacityReader = (client: PoolClient, excludeReservationId?: string) => Promise<ProviderChannelSnapshot>;
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
    private readonly readLockedCapacity?: LockedCapacityReader,
  ) {}

  async enabled(): Promise<boolean> {
    // A manager must never hold a bypass grant while a test can be queued.
    // The common channel gate therefore stays active before audio is uploaded
    // and while automatic reminders are off.
    return true;
  }

  private async cleanup(client: PoolClient): Promise<void> {
    // A pending manager cannot INVITE after expiry: authorization checks the
    // lease again. An issued intent survives expiry until exact end proof.
    // Robot INVITEs have separate durable receipts which survive lease removal.
    await client.query(`DELETE FROM telephony_line_reservations WHERE lease_until <= now()
      AND (owner_type = 'robot' OR dial_authorized_at IS NULL)`);
    await client.query(`DELETE FROM telephony_line_reservations lease WHERE owner_type = 'manager'
      AND EXISTS (SELECT 1 FROM telephony_calls call WHERE call.ended_at IS NOT NULL
        AND call.status IN ('ended','failed','declined','missed')
        AND call.ended_at AT TIME ZONE 'UTC' >= lease.dial_authorized_at
        AND lease.client_call_id IN (call.client_call_id, call.provider_call_id))
      AND NOT EXISTS (SELECT 1 FROM telephony_calls call
        WHERE lease.client_call_id IN (call.client_call_id, call.provider_call_id)
        AND (call.ended_at IS NULL OR call.status NOT IN ('ended','failed','declined','missed')
          OR call.ended_at AT TIME ZONE 'UTC' < lease.dial_authorized_at))`);
  }

  private valid(snapshot: ProviderChannelSnapshot): boolean {
    return snapshot.known && Number.isInteger(snapshot.occupiedChannels) && snapshot.occupiedChannels >= 0;
  }

  private async readReservations(client: PoolClient): Promise<StoredReservation[]> {
    return (await client.query<StoredReservation>(`SELECT id, extension, client_call_id AS "clientCallId", phone,
      dial_authorized_at AS "authorizedAt", lease_until > now() AS alive
      FROM telephony_line_reservations ORDER BY created_at`)).rows;
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
    if (!this.valid(provider)) return null;
    return this.locked(async client => {
      await this.cleanup(client);
      const current = this.readLockedCapacity ? await this.readLockedCapacity(client) : provider;
      if (!this.valid(current)) return null;
      const existing = await this.readReservations(client);
      const retry = existing.find(row => row.clientCallId === input.clientCallId);
      if (retry) {
        const owned = await client.query(
          `SELECT 1 FROM telephony_line_reservations WHERE id = $1 AND owner_type = $2
             AND owner_user_id IS NOT DISTINCT FROM $3::integer`, [retry.id, input.owner, input.userId ?? null],
        );
        return owned.rowCount && input.extensions.includes(retry.extension) && retry.alive ? retry : null;
      }
      if (input.phone && existing.some(row => row.phone === input.phone)) return null;
      const pending = existing.filter(row => !current.busyExtensions.includes(row.extension)).length;
      // Provider webhooks include incoming calls before they reach a user.
      // Counting their distinct provider IDs is conservative when an old row
      // has not been reconciled yet; it can postpone a robot, never add a line.
      const active = await client.query<{ count: string }>(
        `SELECT count(DISTINCT COALESCE(provider_call_id, client_call_id))::text AS count
         FROM telephony_calls WHERE ended_at IS NULL AND status IN ('dialing','ringing','connected')`,
      );
      // The CRM reader already joins leases, journal aliases and robot receipts.
      // A provider-only reader still needs the local reservations added below.
      const occupied = this.readLockedCapacity ? current.occupiedChannels
        : Math.max(current.occupiedChannels, Number(active.rows[0]?.count ?? 0)) + pending;
      if (Math.max(existing.length, occupied) >= 2) return null;
      const extension = input.extensions.find(value => !current.busyExtensions.includes(value)
        && !existing.some(row => row.extension === value));
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

  async authorizeManagerDial(id: string, userId: number, extension: string): Promise<boolean> {
    const provider = await this.snapshot().catch(() => ({ known: false, occupiedChannels: 0, busyExtensions: [] }));
    return this.locked(async client => {
      const owned = await client.query<StoredReservation>(`SELECT id, extension, client_call_id AS "clientCallId",
        dial_authorized_at AS "authorizedAt", lease_until > now() AS alive
        FROM telephony_line_reservations WHERE id = $1 AND owner_type = 'manager'
        AND owner_user_id = $2 AND extension = $3`, [id, userId, extension]);
      const lease = owned.rows[0];
      if (!lease) return false;
      // Replaying an acknowledged intent cannot dispatch another call: its UUID
      // remains fixed. Expired pending grants may never be resurrected.
      if (lease.authorizedAt) return lease.alive;
      if (!lease.alive) return false;
      await this.cleanup(client);
      const current = this.readLockedCapacity ? await this.readLockedCapacity(client, id) : provider;
      if (!this.valid(current) || current.occupiedChannels >= 2 || current.busyExtensions.includes(extension)) return false;
      if (!this.readLockedCapacity) {
        const others = (await this.readReservations(client)).filter(row => row.id !== id);
        const pending = others.filter(row => !current.busyExtensions.includes(row.extension)).length;
        if (Math.max(others.length, current.occupiedChannels + pending) >= 2
          || others.some(row => row.extension === extension)) return false;
      }
      const result = await client.query(`UPDATE telephony_line_reservations
        SET dial_authorized_at = now(), lease_until = now() + make_interval(secs => $4)
        WHERE id = $1 AND owner_type = 'manager' AND owner_user_id = $2 AND extension = $3
        AND lease_until > now() AND dial_authorized_at IS NULL`, [id, userId, extension, LEASE_SECONDS]);
      return Boolean(result.rowCount);
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

  async bind(id: string, input: { phone: string; clientCallId: string } &
    ({ jobId: number; testCallId?: never } | { testCallId: string; jobId?: never })): Promise<boolean> {
    return this.locked(async client => {
      const duplicate = await client.query(
        'SELECT 1 FROM telephony_line_reservations WHERE id <> $1 AND phone = $2 AND lease_until > now()', [id, input.phone],
      );
      if (duplicate.rowCount) return false;
      const result = await client.query(
        `UPDATE telephony_line_reservations SET phone = $2, job_id = $3, client_call_id = $4, test_call_id = $5
         WHERE id = $1 AND owner_type = 'robot' AND lease_until > now()`,
        [id, input.phone, input.jobId ?? null, input.clientCallId, input.testCallId ?? null],
      );
      return Boolean(result.rowCount);
    });
  }

  /** The caller holds the shared channel mutex through its durable dial marker. */
  async canAuthorizeRobotLocked(client: PoolClient, id: string, extension: string): Promise<boolean> {
    const current = this.readLockedCapacity
      ? await this.readLockedCapacity(client, id)
      : await this.snapshot().catch(() => ({ known: false, occupiedChannels: 0, busyExtensions: [] }));
    if (!this.valid(current) || current.occupiedChannels >= 2 || current.busyExtensions.includes(extension)) return false;
    if (this.readLockedCapacity) return true;
    const others = (await this.readReservations(client)).filter(row => row.id !== id);
    const pending = others.filter(row => !current.busyExtensions.includes(row.extension)).length;
    return Math.max(others.length, current.occupiedChannels + pending) < 2
      && !others.some(row => row.extension === extension);
  }

  async release(id: string, owner: 'manager' | 'robot', userId?: number, beforeInvite = false): Promise<boolean> {
    return this.locked(async client => {
      const reservation = await client.query<{ owned: boolean; authorizedAt: Date | null; clientCallId: string }>(
        `SELECT owner_type = $2 AND owner_user_id IS NOT DISTINCT FROM $3::integer AS owned,
          dial_authorized_at AS "authorizedAt", client_call_id AS "clientCallId"
          FROM telephony_line_reservations WHERE id = $1`, [id, owner, userId ?? null],
      );
      const lease = reservation.rows[0];
      if (!lease) return true;
      if (!lease.owned) return false;
      if (owner === 'manager' && lease.authorizedAt) {
        const ledger = await client.query<{ terminal: boolean }>(`SELECT ended_at IS NOT NULL
          AND ended_at AT TIME ZONE 'UTC' >= $2::timestamptz
          AND status IN ('ended','failed','declined','missed') AS terminal FROM telephony_calls
          WHERE $1 IN (client_call_id, provider_call_id)`, [lease.clientCallId, lease.authorizedAt]);
        const ended = ledger.rows.length > 0 && ledger.rows.every(row => row.terminal);
        if (!ended && !(beforeInvite && ledger.rows.length === 0)) return false;
      }
      await client.query('DELETE FROM telephony_line_reservations WHERE id = $1', [id]);
      return true;
    });
  }
}
