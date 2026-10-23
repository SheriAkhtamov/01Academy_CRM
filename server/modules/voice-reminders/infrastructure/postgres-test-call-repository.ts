import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { hasVoiceReminderConfirmationAudio, voiceReminderResponseSchema, voiceReminderAudioIdSchema, normalizeVoiceReminderTestPhone, selectVoiceReminderAudioParts, voiceReminderAudioDurationValid, voiceReminderClockTimeSchema,
  type VoiceReminderResponse, type VoiceReminderTestCall, type VoiceReminderTestCallInput } from '@shared/contracts/voice-reminders';
import { VoiceReminderError } from '../domain/policy';
import type { ClaimedVoiceReminderTestCall, PreparedVoiceReminderTestCall, VoiceReminderCallResult, VoiceReminderTestCallRepository } from '../application/ports';
import { readVoiceReminderAudioLibrary } from './postgres-repository';
import { testCallActorSql, testCallAudioPinsSql } from './test-call-queries';

type TestRow = Omit<VoiceReminderTestCall, 'respondedAt'> & {
  actorUserId: number | null;
  leaseToken: string | null;
  expiresAt: Date;
  startedAt: Date | null;
  confirmationEnabled: boolean;
  providerCallId: string | null;
  respondedAt: Date | null;
};
const fields = `test.id,test.language,test.status,test.phone,test.clock_time AS "clockTime",test.reminder_kind AS "reminderKind",test.actor_user_id AS "actorUserId",
  test.response,test.reminder_reason AS reason,test.response_at AS "respondedAt",test.confirmation_enabled AS "confirmationEnabled",test.provider_call_id AS "providerCallId",
  test.lease_token AS "leaseToken",test.expires_at AS "expiresAt",test.dial_started_at AS "startedAt"`;
const publicCall = ({ id, status, phone, clockTime, reminderKind, language, response, respondedAt, reason }: TestRow): VoiceReminderTestCall => ({
  id, status, phone, clockTime, reminderKind, language: language ?? 'ru', response: response ?? null, respondedAt: respondedAt?.toISOString() ?? null,
  reason: reason ?? null,
});
const liveSql = `SELECT ${fields} FROM voice_reminder_test_calls test JOIN users staff ON staff.id=test.actor_user_id
  WHERE test.id=$1 AND test.lease_token=$2 AND test.status='calling' AND test.lease_until>$3
    AND test.expires_at>$3 AND ${testCallActorSql()}`;

export class PostgresVoiceReminderTestCallRepository implements VoiceReminderTestCallRepository {
  constructor(private readonly database: Pool) {}

  private async transaction<Value>(work: (connection: PoolClient) => Promise<Value>): Promise<Value> {
    const connection = await this.database.connect();
    try {
      await connection.query('BEGIN');
      const result = await work(connection);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK'); throw error;
    } finally { connection.release(); }
  }

  private async requireActor(connection: Pick<Pool, 'query'>, actorId: number) {
    const eligible = await connection.query(`SELECT 1 FROM users staff WHERE staff.id=$1 AND ${testCallActorSql()}`, [actorId]);
    if (!eligible.rowCount) throw new VoiceReminderError('accessDenied', 403);
  }

  private async recoverWith(connection: Pick<Pool, 'query'>, now: Date): Promise<void> {
    await connection.query(`UPDATE voice_reminder_test_calls test SET status=CASE
        WHEN test.dial_started_at IS NOT NULL THEN 'failed'
        WHEN test.expires_at>$1 AND EXISTS (SELECT 1 FROM users staff WHERE staff.id=test.actor_user_id AND ${testCallActorSql()})
          THEN 'waiting' ELSE 'cancelled' END,
      lease_token=NULL,lease_until=NULL,not_before_at=$1,
      completed_at=CASE WHEN test.dial_started_at IS NULL AND test.expires_at>$1
        AND EXISTS (SELECT 1 FROM users staff WHERE staff.id=test.actor_user_id AND ${testCallActorSql()}) THEN NULL ELSE $1 END,updated_at=$1
      WHERE test.status='calling' AND test.lease_until<=$1`, [now]);
    await connection.query(`UPDATE voice_reminder_test_calls test SET status=CASE
        WHEN test.dial_started_at IS NULL THEN 'cancelled' ELSE 'failed' END,
      lease_token=NULL,lease_until=NULL,completed_at=$1,updated_at=$1
      WHERE test.status IN ('waiting','calling') AND (test.expires_at<=$1 OR NOT EXISTS (
        SELECT 1 FROM users staff WHERE staff.id=test.actor_user_id AND ${testCallActorSql()}))`, [now]);
  }

  async enqueue(actorId: number, input: VoiceReminderTestCallInput, now: Date, expiresAt: Date): Promise<VoiceReminderTestCall> {
    const reminderKind = input.reminderKind ?? 'same_day';
    const language = input.language ?? 'ru';
    const phone = normalizeVoiceReminderTestPhone(input.phone);
    if (!phone) throw new VoiceReminderError('voiceReminderInvalidPhone', 400);
    if (!voiceReminderClockTimeSchema.safeParse(input.clockTime).success) throw new VoiceReminderError('voiceReminderInvalidTime', 400);
    return this.transaction(async connection => {
      await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-test-actor:${actorId}`]);
      await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-test-request:${input.requestId}`]);
      await this.requireActor(connection, actorId);
      const existing = (await connection.query<TestRow>(`SELECT ${fields} FROM voice_reminder_test_calls test WHERE test.id=$1`, [input.requestId])).rows[0];
      if (existing) {
        if (existing.actorUserId !== actorId || existing.phone !== phone || existing.clockTime !== input.clockTime || existing.reminderKind !== reminderKind || (existing.language ?? 'ru') !== language) {
          throw new VoiceReminderError('voiceReminderTestRequestChanged', 409);
        }
        return publicCall(existing);
      }
      await this.recoverWith(connection, now);
      const pending = await connection.query(`SELECT 1 FROM voice_reminder_test_calls
        WHERE actor_user_id=$1 AND status IN ('waiting','calling') LIMIT 1`, [actorId]);
      if (pending.rowCount) throw new VoiceReminderError('voiceReminderTestAlreadyPending', 409);
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR SHARE');
      const library = await readVoiceReminderAudioLibrary(connection, language);
      const confirmationEnabled = (await connection.query<{ enabled: boolean }>('SELECT confirmation_enabled AS enabled FROM voice_reminder_settings WHERE id=1')).rows[0]?.enabled;
      if (confirmationEnabled && !hasVoiceReminderConfirmationAudio(library)) throw new VoiceReminderError('voiceReminderConfirmationAudioRequired', 409);
      if (!selectVoiceReminderAudioParts(library,input.clockTime,reminderKind)) throw new VoiceReminderError('voiceReminderAudioRequired', 409);
      if (!voiceReminderAudioDurationValid(library)) throw new VoiceReminderError('voiceReminderAudioTooLong', 400);
      const inserted = (await connection.query<TestRow>(`INSERT INTO voice_reminder_test_calls
        (id,actor_user_id,phone,clock_time,expires_at,created_at,updated_at,reminder_kind,language) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8)
        RETURNING id,language,status,phone,clock_time AS "clockTime",reminder_kind AS "reminderKind",actor_user_id AS "actorUserId",expires_at AS "expiresAt",
          lease_token AS "leaseToken",dial_started_at AS "startedAt"`, [input.requestId,actorId,phone,input.clockTime,expiresAt,now,reminderKind,language])).rows[0];
      return publicCall(inserted);
    });
  }

  async current(actorId: number): Promise<VoiceReminderTestCall | null> {
    await this.requireActor(this.database, actorId);
    const row = (await this.database.query<TestRow>(`SELECT ${fields} FROM voice_reminder_test_calls test
      WHERE test.actor_user_id=$1 ORDER BY (test.status IN ('waiting','calling')) DESC,test.created_at DESC,test.id DESC LIMIT 1`, [actorId])).rows[0];
    return row ? publicCall(row) : null;
  }

  recover(now: Date) { return this.recoverWith(this.database, now); }

  async claim(now: Date, leaseSeconds: number): Promise<ClaimedVoiceReminderTestCall | null> {
    return this.transaction(async connection => {
      await connection.query("SELECT pg_advisory_xact_lock(hashtext('voice-reminder-test-queue'))");
      await this.recoverWith(connection, now);
      const active = (await connection.query<{ count: number }>(`SELECT count(*)::int AS count FROM voice_reminder_test_calls
        WHERE status='calling' AND lease_until>$1`, [now])).rows[0].count;
      if (active >= 2) return null;
      const token = randomUUID();
      const row = (await connection.query<TestRow>(`UPDATE voice_reminder_test_calls test SET status='calling',lease_token=$2,
        lease_until=$1::timestamptz+($3*interval '1 second'),not_before_at=NULL,updated_at=$1
        WHERE test.id=(SELECT pending.id FROM voice_reminder_test_calls pending
          JOIN users staff ON staff.id=pending.actor_user_id CROSS JOIN voice_reminder_settings settings
          WHERE pending.status='waiting' AND pending.dial_started_at IS NULL AND pending.expires_at>$1
            AND (pending.not_before_at IS NULL OR pending.not_before_at<=$1) AND ${testCallActorSql()}
            AND settings.id=1 AND voice_reminder_library_ready(pending.language,pending.clock_time,pending.reminder_kind,settings.confirmation_enabled)
          ORDER BY pending.created_at,pending.id FOR UPDATE OF pending SKIP LOCKED LIMIT 1)
        RETURNING id,language,status,phone,clock_time AS "clockTime",reminder_kind AS "reminderKind",actor_user_id AS "actorUserId",expires_at AS "expiresAt",
          lease_token AS "leaseToken",dial_started_at AS "startedAt"`, [now,token,leaseSeconds])).rows[0];
      return row ? { id: row.id, actorUserId: row.actorUserId!, leaseToken: token, expiresAt: row.expiresAt, reminderKind: row.reminderKind, language: row.language ?? 'ru' } : null;
    });
  }

  async prepare(job: ClaimedVoiceReminderTestCall, now: Date): Promise<PreparedVoiceReminderTestCall | 'defer' | null> {
    return this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR SHARE');
      const row = (await connection.query<TestRow>(`${liveSql} FOR UPDATE OF test`, [job.id,job.leaseToken,now])).rows[0];
      if (!row || row.startedAt) return null;
      const library = await readVoiceReminderAudioLibrary(connection, row.language ?? 'ru');
      const parts = selectVoiceReminderAudioParts(library,row.clockTime,row.reminderKind);
      const confirmationEnabled = (await connection.query<{ enabled: boolean }>('SELECT confirmation_enabled AS enabled FROM voice_reminder_settings WHERE id=1')).rows[0]?.enabled ?? false;
      if (!parts || !voiceReminderAudioDurationValid(library) || (confirmationEnabled && !hasVoiceReminderConfirmationAudio(library))) return 'defer';
      await connection.query(`UPDATE voice_reminder_test_calls SET audio_mode=$3,intro_audio_id=$4,outro_audio_id=$5,
        time_audio_id=$6,hour_audio_id=$7,minute_audio_id=$8,confirmation_enabled=$9,
        confirmation_yes_audio_id=$10,confirmation_no_audio_id=$11 WHERE id=$1 AND lease_token=$2`, [
        job.id,job.leaseToken,parts.kind,parts.intro.id,parts.outro.id,
        parts.kind==='time' ? parts.time.id : null,parts.kind==='clock' ? parts.hour.id : null,
        parts.kind==='clock' ? parts.minute.id : null,confirmationEnabled,
        confirmationEnabled ? library.confirmationYes!.id : null,confirmationEnabled ? library.confirmationNo!.id : null,
      ]);
      return { ...job, language: row.language ?? 'ru', phone: row.phone, clockTime: row.clockTime, audioParts: parts,
        confirmation: confirmationEnabled ? { yesAudio: library.confirmationYes!, noAudio: library.confirmationNo!, promptDurationSeconds: parts.outro.durationSeconds } : null };
    });
  }

  async canContinue(job: ClaimedVoiceReminderTestCall, now: Date, verifyAudio = true): Promise<boolean> {
    return this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR SHARE');
      const result = await connection.query(`SELECT 1 FROM voice_reminder_test_calls test
        JOIN users staff ON staff.id=test.actor_user_id CROSS JOIN voice_reminder_settings settings
        WHERE test.id=$1 AND test.lease_token=$2 AND test.status='calling' AND test.lease_until>$3 AND test.expires_at>$3
          AND test.language=$4 AND settings.id=1 AND test.confirmation_enabled=settings.confirmation_enabled AND ${testCallActorSql()} ${verifyAudio ? `AND ${testCallAudioPinsSql()}` : ''}`, [job.id,job.leaseToken,now,job.language ?? 'ru']);
      return Boolean(result.rowCount);
    });
  }

  async recordResponse(job: ClaimedVoiceReminderTestCall, phone: string, response: VoiceReminderResponse, now: Date, callId: string): Promise<boolean> {
    if (!voiceReminderResponseSchema.safeParse(response).success || !voiceReminderAudioIdSchema.safeParse(callId).success) return false;
    return this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR SHARE');
      await connection.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [job.actorUserId]);
      const attempt = await connection.query<{ providerId: string | null }>(`SELECT provider_id AS "providerId" FROM voice_reminder_call_attempts WHERE call_id=$1::uuid AND test_call_id=$2::uuid
        AND phone=$3 AND completed_at IS NULL AND termination_confirmed_at IS NULL FOR SHARE`, [callId,job.id,phone]);
      if (!attempt.rowCount) return false;
      await connection.query('SELECT id FROM voice_reminder_test_calls WHERE id=$1 AND lease_token=$2 FOR UPDATE', [job.id,job.leaseToken]);
      const effectiveNow = (await connection.query<{ now: Date }>('SELECT GREATEST($1::timestamptz,clock_timestamp()) AS now', [now])).rows[0].now;
      const row = (await connection.query<TestRow>(`${liveSql} FOR UPDATE OF test`, [job.id,job.leaseToken,effectiveNow])).rows[0];
      const enabled = (await connection.query<{ enabled: boolean }>('SELECT confirmation_enabled AS enabled FROM voice_reminder_settings WHERE id=1')).rows[0]?.enabled;
      const boundProviderId = attempt.rows[0].providerId;
      const sameCall = row?.providerCallId===callId || Boolean(boundProviderId && row?.providerCallId===boundProviderId);
      if (!row || (row.language ?? 'ru') !== (job.language ?? 'ru') || !enabled || !row.confirmationEnabled || row.phone!==phone || !sameCall || !row.startedAt) return false;
      if (row.response) return row.response===response;
      const saved = await connection.query(`UPDATE voice_reminder_test_calls SET response=$3,response_at=$4,response_call_id=$5,updated_at=$4
        WHERE id=$1 AND lease_token=$2 AND status='calling' AND response IS NULL`, [job.id,job.leaseToken,response,effectiveNow,callId]);
      return saved.rowCount===1;
    });
  }

  async renew(job: ClaimedVoiceReminderTestCall, now: Date, leaseSeconds: number): Promise<boolean> {
    const result = await this.database.query(`UPDATE voice_reminder_test_calls SET lease_until=$3::timestamptz+($4*interval '1 second')
      WHERE id=$1 AND lease_token=$2 AND status='calling' AND lease_until>$3 AND expires_at>$3`, [job.id,job.leaseToken,now,leaseSeconds]);
    return Boolean(result.rowCount);
  }

  async finish(job: ClaimedVoiceReminderTestCall, result: VoiceReminderCallResult, now: Date): Promise<void> {
    await this.database.query(`UPDATE voice_reminder_test_calls SET status=CASE WHEN $3='delivered_no_response' THEN CASE WHEN response IS NOT NULL THEN 'played' WHEN confirmation_enabled AND $6 THEN 'delivered_no_response' ELSE 'failed' END ELSE $3 END,lease_token=NULL,lease_until=NULL,not_before_at=NULL,
      completed_at=$4,updated_at=$4,provider_call_id=COALESCE(provider_call_id,$5),reminder_reason=$7,
      dial_started_at=CASE WHEN $6 THEN COALESCE(dial_started_at,$4) ELSE dial_started_at END
      WHERE id=$1 AND lease_token=$2 AND status='calling'`, [job.id,job.leaseToken,
      result.outcome==='delivered_no_response' ? 'delivered_no_response' : result.outcome==='busy' ? 'failed' : result.outcome,now,result.callId?.slice(0,160) ?? null,result.callStarted,result.reason ?? null]);
  }

  async defer(job: ClaimedVoiceReminderTestCall, now: Date): Promise<boolean> {
    const result = await this.database.query(`UPDATE voice_reminder_test_calls SET status='waiting',lease_token=NULL,lease_until=NULL,
      not_before_at=$3::timestamptz+interval '5 seconds',updated_at=$3 WHERE id=$1 AND lease_token=$2 AND status='calling'
      AND dial_started_at IS NULL AND expires_at>$3`, [job.id,job.leaseToken,now]);
    return Boolean(result.rowCount);
  }
}
