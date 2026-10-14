import type { Pool, PoolClient } from 'pg';
import { ONLINE_PBX_TRUNK_NUMBER } from '@shared/telephony';
import { normalizeVoiceReminderTestPhone } from '@shared/contracts/voice-reminders';
import { normalizeReminderPhone } from '../../modules/voice-reminders/domain/policy';
import { testCallActorSql, testCallAudioPinsSql } from '../../modules/voice-reminders/infrastructure/test-call-queries';

type RobotAttempt = { callId: string; jobId: number | null; providerId: string | null };
export type RobotAttemptStart = {
  callId: string;
  jobId: number;
  jobLeaseToken: string;
  extension: string;
  phone: string;
  reservationId: string;
};
export type RobotTestAttemptStart = Omit<RobotAttemptStart, 'jobId' | 'jobLeaseToken'> & {
  testCallId: string;
  testLeaseToken: string;
};
type RobotAdmission = (connection: PoolClient, reservationId: string, extension: string) => Promise<boolean>;

const fields = ['caller', 'callee', 'callee_from', 'callee_to'] as const;
const providerIdFrom = (payload: Record<string, unknown>): string | null => {
  const id = String(payload.uuid ?? '').trim();
  return id && id.length <= 160 ? id : null;
};

/** Robot callbacks are excluded before the legacy contact/manager/KPI path. */
export class RobotCallReceipts {
  constructor(
    private readonly database: Pick<Pool, 'query' | 'connect'>,
    private readonly admit?: RobotAdmission,
  ) {}

  async start(input: RobotAttemptStart): Promise<boolean> {
    const connection = await this.database.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext('onlinepbx:shared-external-channels'))`);
      if (this.admit && !await this.admit(connection, input.reservationId, input.extension)) {
        await connection.query('COMMIT');
        return false;
      }
      const inserted = await connection.query(
        `INSERT INTO voice_reminder_call_attempts(call_id, job_id, extension, phone)
         SELECT $1::uuid,$2::bigint,$3::text,$4::text FROM voice_reminder_jobs job
         JOIN telephony_line_reservations reservation ON reservation.id = $6::uuid
           AND reservation.owner_type = 'robot' AND reservation.lease_until > now()
           AND reservation.extension = $3::text AND reservation.client_call_id = $1::uuid::text
           AND reservation.phone = $4::text AND reservation.job_id = job.id
         WHERE job.id = $2::bigint AND job.lease_token = $5::uuid AND job.status = 'calling' AND job.lease_until > now()
         ON CONFLICT (call_id) DO NOTHING RETURNING call_id`,
        [input.callId, input.jobId, input.extension, input.phone, input.jobLeaseToken, input.reservationId],
      );
      if (inserted.rowCount) {
        await connection.query(`UPDATE telephony_line_reservations SET dial_authorized_at = now()
          WHERE id = $1 AND owner_type = 'robot'`, [input.reservationId]);
        await connection.query(`UPDATE voice_reminder_jobs SET provider_call_id = $3
          WHERE id = $1 AND lease_token = $2 AND status = 'calling'`, [input.jobId, input.jobLeaseToken, input.callId]);
      }
      await connection.query('COMMIT');
      return Boolean(inserted.rowCount);
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }

  async startTest(input: RobotTestAttemptStart): Promise<boolean> {
    const connection = await this.database.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext('onlinepbx:shared-external-channels'))`);
      // Keep the actor, immutable source bindings and channel authorization
      // valid until the one durable dial marker commits. A crash after this
      // marker is ambiguous and must never trigger an automatic second dial.
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id = 1 FOR SHARE');
      await connection.query(`SELECT staff.id FROM users staff JOIN voice_reminder_test_calls test
        ON test.actor_user_id = staff.id WHERE test.id = $1 FOR SHARE OF staff`, [input.testCallId]);
      if (this.admit && !await this.admit(connection, input.reservationId, input.extension)) {
        await connection.query('COMMIT');
        return false;
      }
      const inserted = await connection.query(
        `INSERT INTO voice_reminder_call_attempts(call_id, test_call_id, extension, phone)
         SELECT $1::uuid,test.id,$3::text,$4::text FROM voice_reminder_test_calls test
         JOIN users staff ON staff.id = test.actor_user_id
         JOIN voice_reminder_settings settings ON settings.id = 1
         JOIN telephony_line_reservations reservation ON reservation.id = $6::uuid
           AND reservation.owner_type = 'robot' AND reservation.lease_until > now()
           AND reservation.extension = $3::text AND reservation.client_call_id = $1::uuid::text
           AND reservation.phone = $4::text AND reservation.test_call_id = test.id AND reservation.job_id IS NULL
         WHERE test.id = $2::uuid AND test.lease_token = $5::uuid AND test.status = 'calling'
           AND test.lease_until > now() AND test.expires_at > now() AND test.dial_started_at IS NULL
           AND test.phone = $4::text AND (${testCallActorSql()}) AND (${testCallAudioPinsSql()})
         ON CONFLICT DO NOTHING RETURNING call_id`,
        [input.callId, input.testCallId, input.extension, input.phone, input.testLeaseToken, input.reservationId],
      );
      if (inserted.rowCount) {
        await connection.query(`UPDATE telephony_line_reservations SET dial_authorized_at = now()
          WHERE id = $1 AND owner_type = 'robot'`, [input.reservationId]);
        await connection.query(`UPDATE voice_reminder_test_calls SET dial_started_at = now(), provider_call_id = $3
          WHERE id = $1 AND lease_token = $2 AND status = 'calling'`, [input.testCallId, input.testLeaseToken, input.callId]);
      }
      await connection.query('COMMIT');
      return Boolean(inserted.rowCount);
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }

  async complete(callId: string, callStarted: boolean, terminationConfirmed = false): Promise<void> {
    if (!callStarted) {
      const connection = await this.database.connect();
      try {
        await connection.query('BEGIN');
        await connection.query(`SELECT pg_advisory_xact_lock(hashtext('onlinepbx:shared-external-channels'))`);
        const removed = await connection.query<{ testCallId: string | null }>(
          `DELETE FROM voice_reminder_call_attempts WHERE call_id = $1 AND provider_id IS NULL
           RETURNING test_call_id AS "testCallId"`, [callId],
        );
        const testCallId = removed.rows[0]?.testCallId;
        if (testCallId) {
          // Transport explicitly proved no INVITE was issued. Only this exact
          // unbound marker may be cleared for a fresh audio preparation.
          await connection.query(`UPDATE voice_reminder_test_calls SET dial_started_at = NULL, provider_call_id = NULL
            WHERE id = $1 AND provider_call_id = $2 AND status = 'calling'`, [testCallId, callId]);
        }
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
      return;
    }
    await this.database.query(`UPDATE voice_reminder_call_attempts SET completed_at = now(),
      termination_confirmed_at = CASE WHEN $2 THEN COALESCE(termination_confirmed_at, now()) ELSE termination_confirmed_at END
      WHERE call_id = $1`, [callId, terminationConfirmed]);
  }

  async observe(payload: Record<string, unknown>): Promise<boolean> {
    const providerId = providerIdFrom(payload);
    if (!providerId) return false;
    const exact = await this.database.query(
      `SELECT 1 FROM voice_reminder_call_attempts WHERE call_id::text = $1 OR provider_id = $1
       UNION ALL SELECT 1 FROM voice_reminder_provider_quarantine WHERE provider_id = $1 LIMIT 1`, [providerId],
    );
    if (exact.rowCount) {
      await this.confirmProviderEnd(this.database, providerId, payload);
      return true;
    }
    const outgoing = String(payload.direction ?? '').toLowerCase().includes('out');
    const digits = fields.map(field => String(payload[field] ?? '').replace(/\D/g, '')).filter(Boolean);
    const extensions = [...new Set(digits.filter(value => /^\d{3,4}$/.test(value)))];
    const phones = [...new Set(digits.filter(value => value !== ONLINE_PBX_TRUNK_NUMBER)
      .flatMap(value => [normalizeReminderPhone(value), normalizeVoiceReminderTestPhone(`+${value}`)])
      .filter((value): value is string => Boolean(value)))];
    const startedAt = Number(payload.date);
    const matched = await this.matchAndRecord({ providerId, extensions, phones, startedAt, outgoing });
    if (matched) await this.confirmProviderEnd(this.database, providerId, payload);
    return matched;
  }

  private async confirmProviderEnd(connection: Pick<Pool, 'query'>, providerId: string, payload: Record<string, unknown>): Promise<void> {
    if (String(payload.event ?? '').toLowerCase() !== 'call_end') return;
    await connection.query(`UPDATE voice_reminder_call_attempts
      SET termination_confirmed_at = COALESCE(termination_confirmed_at, now())
      WHERE call_id::text = $1 OR provider_id = $1`, [providerId]);
  }

  private async matchAndRecord(input: { providerId: string; extensions: string[]; phones: string[]; startedAt: number; outgoing: boolean }): Promise<boolean> {
    const connection = await this.database.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`voice-robot-provider:${input.providerId}`]);
      // Provider callbacks can arrive together before the first identity bind
      // commits. Recheck under the same per-provider lock before falling back.
      const known = await connection.query(
        `SELECT 1 FROM voice_reminder_call_attempts WHERE call_id::text = $1 OR provider_id = $1
         UNION ALL SELECT 1 FROM voice_reminder_provider_quarantine WHERE provider_id = $1 LIMIT 1`, [input.providerId],
      );
      if (known.rowCount) { await connection.query('COMMIT'); return true; }
      const manual = await connection.query(`SELECT 1 FROM telephony_calls
        WHERE user_id IS NOT NULL AND (provider_call_id = $1 OR client_call_id = $1) LIMIT 1`, [input.providerId]);
      if (manual.rowCount) { await connection.query('COMMIT'); return false; }
      if (!input.outgoing || !input.extensions.length || !input.phones.length
        || !Number.isFinite(input.startedAt) || input.startedAt <= 0) {
        await connection.query('COMMIT'); return false;
      }
      // Two different attempts can share a contact. Only a single exact line,
      // number and narrow provider start-time match may acquire a new identity.
      const candidates = await connection.query<RobotAttempt>(
        `SELECT call_id AS "callId", job_id AS "jobId", provider_id AS "providerId"
         FROM voice_reminder_call_attempts WHERE provider_id IS NULL
           AND phone = ANY($1::text[]) AND extension = ANY($2::text[])
           AND ABS(EXTRACT(EPOCH FROM started_at) - $3::double precision) <= 5
         FOR UPDATE`, [input.phones, input.extensions, input.startedAt],
      );
      if (!candidates.rowCount) { await connection.query('COMMIT'); return false; }
      if (candidates.rows.length > 1) {
        await connection.query(`INSERT INTO voice_reminder_provider_quarantine(provider_id) VALUES($1)
          ON CONFLICT (provider_id) DO NOTHING`, [input.providerId]);
        await connection.query('COMMIT');
        return true;
      }
      const attempt = candidates.rows[0];
      await connection.query(`UPDATE voice_reminder_call_attempts SET provider_id = $2 WHERE call_id = $1`, [attempt.callId, input.providerId]);
      await this.recordJobProvider(connection, attempt, input.providerId);
      await connection.query('COMMIT');
      return true;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }

  private async recordJobProvider(connection: PoolClient, attempt: RobotAttempt, providerId: string): Promise<void> {
    if (!attempt.jobId) return;
    // A delayed callback from attempt 1 must never replace attempt 2's identity.
    await connection.query(`UPDATE voice_reminder_jobs SET provider_call_id = $3
      WHERE id = $1 AND provider_call_id = $2`, [attempt.jobId, attempt.callId, providerId]);
  }
}
