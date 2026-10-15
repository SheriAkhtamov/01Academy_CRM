import type { Pool, PoolClient } from 'pg';
import type { OnlinePbxCallHistoryItem, OnlinePbxClient } from '../../services/onlinepbx';
import type { ProviderChannelSnapshot } from './channel-reservations';

type QueryConnection = Pick<Pool, 'query'>;
type CallRow = {
  id: number;
  clientCallId: string | null;
  providerCallId: string | null;
  extension: string | null;
  ownerExtension: string | null;
  userId: number | null;
  direction: string;
  status: string;
  phone: string;
  startedAtMs: number;
  updatedAtMs: number;
  endedAtMs: number | null;
};
type LeaseRow = {
  id: string; clientCallId: string; extension: string; phone: string | null;
  owner: 'manager' | 'robot'; createdAtMs: number; leaseUntilMs: number; authorizedAtMs: number | null;
};
type RobotRow = {
  callId: string; providerCallId: string | null; extension: string; phone: string;
  startedAtMs: number; completedAtMs: number | null; terminationConfirmedAtMs: number | null;
};
type CapacityRecords = { calls: CallRow[]; leases: LeaseRow[]; robots: RobotRow[] };
type Probe = {
  key: string; ids: string[]; phone: string | null; startedAtMs: number;
  call?: CallRow; lease?: LeaseRow; robot?: RobotRow;
};

const ACTIVE = new Set(['dialing', 'ringing', 'connected']);
const TERMINAL = new Set(['ended', 'failed', 'declined', 'missed']);
const CRM_EXTENSIONS = ['100', '101'];
const unknown = (): ProviderChannelSnapshot => ({ known: false, occupiedChannels: 0, busyExtensions: [] });
const aliases = (call: { clientCallId: string | null; providerCallId: string | null }): string[] => (
  [call.clientCallId, call.providerCallId].filter((value): value is string => Boolean(value))
);
const terminal = (call: CallRow) => TERMINAL.has(call.status) && call.endedAtMs !== null;
const epochSeconds = (value: number): number => value > 1_000_000_000_000 ? value / 1000 : value;

/**
 * This source accounts for CRM-only calls and the CRM's durable dial intents.
 * It deliberately makes no statement about phones connected outside the CRM.
 */
export class CrmCapacitySource {
  private inFlight: Promise<ProviderChannelSnapshot> | null = null;
  private readonly checkedAt = new Map<string, number>();
  private readonly failed = new Set<string>();
  private readonly now: () => number;
  private readonly staleAfterMs: number;

  constructor(
    private readonly database: Pick<Pool, 'query' | 'connect'>,
    private readonly history: Pick<OnlinePbxClient, 'getCallHistory'>,
    options: { now?: () => number; staleAfterMs?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.staleAfterMs = options.staleAfterMs ?? 120_000;
  }

  snapshot(): Promise<ProviderChannelSnapshot> {
    if (this.inFlight) return this.inFlight;
    const work = this.reconcileAndRead().catch(() => unknown());
    this.inFlight = work;
    void work.finally(() => { if (this.inFlight === work) this.inFlight = null; });
    return work;
  }

  /** Call this again inside the same advisory transaction as admission. */
  async readLocked(connection: QueryConnection, excludeReservationId?: string): Promise<ProviderChannelSnapshot> {
    const records = await this.readRecords(connection);
    if (excludeReservationId) records.leases = records.leases.filter(lease => lease.id !== excludeReservationId);
    const snapshot = this.project(records);
    if (this.probes(records).some(probe => this.failed.has(probe.key))) snapshot.known = false;
    return snapshot;
  }

  private async readRecords(connection: QueryConnection): Promise<CapacityRecords> {
    const calls = await connection.query<CallRow>(`SELECT call.id, call.client_call_id AS "clientCallId", call.provider_call_id AS "providerCallId",
        call.extension, employee.online_pbx_extension AS "ownerExtension", call.user_id AS "userId", call.direction, call.status, call.phone,
        EXTRACT(EPOCH FROM call.started_at AT TIME ZONE 'UTC')::float8 * 1000 AS "startedAtMs",
        EXTRACT(EPOCH FROM call.updated_at AT TIME ZONE 'UTC')::float8 * 1000 AS "updatedAtMs",
        EXTRACT(EPOCH FROM call.ended_at AT TIME ZONE 'UTC')::float8 * 1000 AS "endedAtMs"
        FROM telephony_calls call LEFT JOIN users employee ON employee.id = call.user_id
        WHERE NOT (call.ended_at IS NOT NULL AND call.status IN ('ended','failed','declined','missed'))
          OR EXISTS (SELECT 1 FROM telephony_line_reservations lease
          WHERE lease.client_call_id = call.client_call_id OR lease.client_call_id = call.provider_call_id)`);
    const leases = await connection.query<LeaseRow>(`SELECT id, client_call_id AS "clientCallId", extension, phone, owner_type AS owner,
        EXTRACT(EPOCH FROM created_at)::float8 * 1000 AS "createdAtMs",
        EXTRACT(EPOCH FROM lease_until)::float8 * 1000 AS "leaseUntilMs",
        EXTRACT(EPOCH FROM dial_authorized_at)::float8 * 1000 AS "authorizedAtMs" FROM telephony_line_reservations`);
    const robots = await connection.query<RobotRow>(`SELECT call_id AS "callId", provider_id AS "providerCallId", extension, phone,
        EXTRACT(EPOCH FROM started_at)::float8 * 1000 AS "startedAtMs",
        EXTRACT(EPOCH FROM completed_at)::float8 * 1000 AS "completedAtMs",
        EXTRACT(EPOCH FROM termination_confirmed_at)::float8 * 1000 AS "terminationConfirmedAtMs"
        FROM voice_reminder_call_attempts attempt WHERE termination_confirmed_at IS NULL
          OR EXISTS (SELECT 1 FROM telephony_line_reservations lease WHERE lease.client_call_id = attempt.call_id::text)`);
    return { calls: calls.rows, leases: leases.rows, robots: robots.rows };
  }

  private project(records: CapacityRecords): ProviderChannelSnapshot {
    const identities = new Map<string, string>();
    const occupied = new Set<string>();
    const busy = new Set<string>();
    let known = true;
    const join = (ids: string[]) => {
      const old = ids.map(id => identities.get(id)).filter((id): id is string => Boolean(id));
      const key = old[0] ?? ids[0];
      if (!key) { known = false; return; }
      for (const previous of old) {
        if (previous === key) continue;
        occupied.delete(previous);
        for (const [alias, value] of identities) if (value === previous) identities.set(alias, key);
      }
      ids.forEach(id => identities.set(id, key));
      occupied.add(key);
    };
    const endedIds = new Set(records.calls.filter(call => terminal(call)
      && !records.leases.some(lease => aliases(call).includes(lease.clientCallId)
        && lease.authorizedAtMs !== null && call.endedAtMs! + 1000 < lease.authorizedAtMs)).flatMap(aliases));
    for (const call of records.calls) {
      if (terminal(call)) continue;
      const ids = aliases(call);
      join(ids.length ? ids : [`unidentified:${call.id}`]);
      if (!ids.length || !ACTIVE.has(call.status)) known = false;
      const extension = call.status === 'connected' && call.userId && CRM_EXTENSIONS.includes(call.ownerExtension ?? '')
        ? call.ownerExtension : CRM_EXTENSIONS.includes(call.extension ?? '') ? call.extension : call.ownerExtension;
      if (call.direction === 'incoming' && (call.status !== 'connected' || !call.userId || !CRM_EXTENSIONS.includes(extension ?? ''))) {
        CRM_EXTENSIONS.forEach(value => busy.add(value));
      } else if (extension) busy.add(extension);
      else known = false;
    }
    for (const robot of records.robots) {
      if (robot.terminationConfirmedAtMs !== null) {
        endedIds.add(robot.callId);
        if (robot.providerCallId) endedIds.add(robot.providerCallId);
        continue;
      }
      join([robot.callId, ...(robot.providerCallId ? [robot.providerCallId] : [])]);
      busy.add(robot.extension);
      const liveLease = records.leases.some(lease => lease.clientCallId === robot.callId && lease.leaseUntilMs > this.now());
      if (robot.completedAtMs !== null || !liveLease) known = false;
    }
    for (const lease of records.leases) {
      if (endedIds.has(lease.clientCallId)) continue;
      if (lease.authorizedAtMs === null && lease.leaseUntilMs <= this.now()) continue;
      join([lease.clientCallId]);
      busy.add(lease.extension);
      const active = records.calls.some(call => !terminal(call) && aliases(call).includes(lease.clientCallId));
      const robot = records.robots.some(call => call.callId === lease.clientCallId && call.terminationConfirmedAtMs === null);
      if (lease.authorizedAtMs !== null && lease.leaseUntilMs <= this.now() && !active && !robot) known = false;
    }
    return { known: known && occupied.size <= 2, occupiedChannels: occupied.size, busyExtensions: [...busy] };
  }

  private probes(records: CapacityRecords): Probe[] {
    const probes: Probe[] = [];
    for (const call of records.calls) {
      // A restored browser can keep replaying an old active snapshot even when
      // its SDK never recovered that dialog. Heartbeats must not suppress an
      // exact history check forever. Age triggers a read, never a free channel.
      if (!terminal(call) && this.now() - Math.min(call.startedAtMs,call.updatedAtMs) >= this.staleAfterMs) {
        const issuedAt = records.leases.filter(lease => aliases(call).includes(lease.clientCallId))
          .map(lease => lease.authorizedAtMs ?? lease.createdAtMs);
        probes.push({ key: `call:${call.id}`, ids: aliases(call), phone: call.phone,
          startedAtMs: Math.max(call.startedAtMs, ...issuedAt), call });
      }
    }
    for (const lease of records.leases) {
      if (lease.authorizedAtMs === null || lease.leaseUntilMs > this.now()) continue;
      if (records.calls.some(call => aliases(call).includes(lease.clientCallId))) continue;
      probes.push({ key: `lease:${lease.id}`, ids: [lease.clientCallId], phone: lease.phone, startedAtMs: lease.createdAtMs, lease });
    }
    for (const robot of records.robots) {
      if (robot.terminationConfirmedAtMs !== null) continue;
      if (robot.completedAtMs === null && this.now() - robot.startedAtMs < this.staleAfterMs) continue;
      probes.push({ key: `robot:${robot.callId}`, ids: [robot.callId, ...(robot.providerCallId ? [robot.providerCallId] : [])], phone: robot.phone, startedAtMs: robot.startedAtMs, robot });
    }
    return probes;
  }

  private async reconcileAndRead(): Promise<ProviderChannelSnapshot> {
    const records = await this.readRecords(this.database);
    const probes = this.probes(records);
    const keys = new Set(probes.map(probe => probe.key));
    for (const key of this.checkedAt.keys()) if (!keys.has(key)) { this.checkedAt.delete(key); this.failed.delete(key); }
    // A permanently unresolved old call must not monopolize every batch. Give
    // never/least recently checked identities a turn while retaining the same
    // bounded provider load and exact positive-end proof requirement.
    const due = probes.filter(probe => this.now() - (this.checkedAt.get(probe.key) ?? 0) >= 30_000)
      .sort((left,right) => (this.checkedAt.get(left.key) ?? 0)-(this.checkedAt.get(right.key) ?? 0))
      .slice(0,4);
    await Promise.all(due.map(async probe => {
      this.checkedAt.set(probe.key, this.now());
      try {
        const ended = await this.findEndedCall(probe);
        if (ended) await this.applyProof(probe, ended);
        this.failed.delete(probe.key);
      } catch { this.failed.add(probe.key); }
    }));
    const snapshot = await this.readLocked(this.database);
    if (probes.some(probe => this.failed.has(probe.key))) snapshot.known = false;
    return snapshot;
  }

  private matchingHistory(items: OnlinePbxCallHistoryItem[], probe: Probe): OnlinePbxCallHistoryItem | null {
    // A transfer/bridge event links another channel, but its UUID is not covered
    // by the parent record's endStamp. Only the ended primary identity is proof.
    const matching = items.filter(item => probe.ids.includes(item.uuid));
    const ids = new Set(matching.map(item => item.uuid));
    if (ids.size > 1) throw new Error('Ambiguous completed call identity');
    const match = matching[0];
    if (!match) return null;
    const start = epochSeconds(match.startStamp);
    const end = epochSeconds(match.endStamp);
    const intentStartedAt = probe.lease?.authorizedAtMs ?? probe.startedAtMs;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start
      || end * 1000 > this.now() + 30_000 || end * 1000 + 1000 < intentStartedAt
      || !Number.isFinite(match.duration) || match.duration < 0
      || !Number.isFinite(match.talkTime) || match.talkTime < 0) throw new Error('Invalid completed call');
    return match;
  }

  private async findEndedCall(probe: Probe): Promise<OnlinePbxCallHistoryItem | null> {
    for (const uuid of [...new Set(probe.ids)]) {
      const match = this.matchingHistory(await this.history.getCallHistory({ uuid }), probe);
      if (match) return match;
    }
    if (!probe.phone || !probe.ids.length) return null;
    return this.matchingHistory(await this.history.getCallHistory({
      phoneNumbers: probe.phone,
      startStampFrom: Math.floor(probe.startedAtMs / 1000) - 120,
      startStampTo: Math.floor(probe.startedAtMs / 1000) + 120,
    }), probe);
  }

  private async applyProof(probe: Probe, ended: OnlinePbxCallHistoryItem): Promise<void> {
    const connection = await this.database.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext('onlinepbx:shared-external-channels'))`);
      await this.recordProof(connection, probe, ended);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK'); throw error;
    } finally { connection.release(); }
  }

  private async recordProof(connection: PoolClient, probe: Probe, ended: OnlinePbxCallHistoryItem): Promise<void> {
    const endStamp = epochSeconds(ended.endStamp);
    if (probe.call) {
      await connection.query(`UPDATE telephony_calls SET status = $2::text,
        ended_at = to_timestamp($3) AT TIME ZONE 'UTC', provider_call_id = COALESCE(provider_call_id, $4),
        duration_seconds = GREATEST(duration_seconds, $5::integer), talk_seconds = GREATEST(talk_seconds, $6::integer),
        updated_at = timezone('UTC', now())
        WHERE id = $1 AND ended_at IS NULL AND client_call_id IS NOT DISTINCT FROM $7::text
          AND provider_call_id IS NOT DISTINCT FROM $8::text`, [
        probe.call.id, ended.talkTime > 0 ? 'ended' : 'failed', endStamp, ended.uuid,
        Math.max(0, Math.floor(ended.duration)), Math.max(0, Math.floor(ended.talkTime)),
        probe.call.clientCallId, probe.call.providerCallId,
      ]);
    }
    if (probe.robot) {
      await connection.query(`UPDATE voice_reminder_call_attempts SET termination_confirmed_at = to_timestamp($2),
        provider_id = COALESCE(provider_id, $3) WHERE call_id = $1`, [probe.robot.callId, endStamp, ended.uuid]);
    }
    await connection.query(`DELETE FROM telephony_line_reservations WHERE client_call_id = ANY($1::text[])
      AND dial_authorized_at < to_timestamp($2 + 1)`, [probe.ids, endStamp]);
  }
}
