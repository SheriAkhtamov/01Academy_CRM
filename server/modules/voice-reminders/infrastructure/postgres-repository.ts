import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  DEFAULT_VOICE_REMINDER_SETTINGS,
  VOICE_REMINDER_STATUSES,
  type VoiceReminderResult,
  type VoiceReminderSettings,
  type VoiceReminderSettingsInput,
  type VoiceReminderStatus,
} from '@shared/contracts/voice-reminders';
import { normalizeReminderPhone, reminderWithinAllowedHours } from '../domain/policy';
import type {
  ClaimedVoiceReminder,
  PreparedVoiceReminder,
  StoredVoiceReminderAudio,
  VoiceReminderCallResult,
  VoiceReminderRepository,
} from '../application/ports';

type SettingsRow = VoiceReminderSettingsInput & { audioId: string | null };
type AudioRow = Omit<StoredVoiceReminderAudio, 'uploadedAt'> & { uploadedAt: Date };
type LiveJobRow = {
  id: string;
  leaseToken: string;
  leaseUntil: Date;
  scheduledAt: Date;
  attempts: number;
  phone: string | null;
  studentPhone: string | null;
  primaryPhone: string | null;
  leadPhone: string | null;
  valid: boolean;
};

const settingsSql = `SELECT enabled, lead_minutes AS "leadMinutes", max_attempts AS "maxAttempts",
  retry_minutes AS "retryMinutes", allowed_start_time AS "allowedStartTime",
  allowed_end_time AS "allowedEndTime", max_concurrent_calls AS "maxConcurrentCalls", audio_id AS "audioId"
  FROM voice_reminder_settings WHERE id = 1`;
const audioSql = `SELECT id, file_name AS "fileName", mime_type AS "mimeType", size_bytes AS "sizeBytes",
  duration_seconds AS "durationSeconds", storage_key AS "storageKey", sha256, uploaded_at AS "uploadedAt"
  FROM voice_reminder_audio WHERE id = $1`;
const validLiveJobSql = `demo.status = 'scheduled'
  AND demo.scheduled_at AT TIME ZONE 'UTC' = job.scheduled_at
  AND demo.voice_reminder_revision = job.lesson_revision
  AND participant.voice_reminder_revision = job.participant_revision
  AND job.scheduled_at > $3 AND participant.status IN ('invited', 'confirmed')
  AND (student.lead_id IS NULL OR (lead.id IS NOT NULL AND lead.is_archived = false))`;
const liveJobSql = `SELECT job.id, job.lease_token AS "leaseToken", job.lease_until AS "leaseUntil",
  job.scheduled_at AS "scheduledAt", job.attempts, job.phone,
  student.phone AS "studentPhone", lead.phone AS "leadPhone",
  (SELECT phone.phone FROM academy_lead_phones phone WHERE phone.lead_id = lead.id
   ORDER BY phone.is_primary DESC, phone.id LIMIT 1) AS "primaryPhone",
  (${validLiveJobSql}) AS valid
  FROM voice_reminder_jobs job
  JOIN academy_demo_lessons demo ON demo.id = job.demo_lesson_id
  JOIN academy_demo_lesson_participants participant ON participant.id = job.participant_id
    AND participant.demo_lesson_id = demo.id
  JOIN academy_students student ON student.id = participant.student_id
  LEFT JOIN academy_leads lead ON lead.id = student.lead_id
  WHERE job.id = $1 AND job.lease_token = $2 AND job.status = 'calling' AND job.lease_until > $3`;

const asAudio = (row: AudioRow): StoredVoiceReminderAudio => ({ ...row, uploadedAt: row.uploadedAt.toISOString() });
const publicAudio = (audio: StoredVoiceReminderAudio) => {
  const { storageKey: _storageKey, sha256: _sha256, ...publicFields } = audio;
  return publicFields;
};
const currentPhone = (row: LiveJobRow) => normalizeReminderPhone(row.studentPhone)
  ?? normalizeReminderPhone(row.primaryPhone)
  ?? normalizeReminderPhone(row.leadPhone);

export class PostgresVoiceReminderRepository implements VoiceReminderRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(action: (connection: PoolClient) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const result = await action(connection);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  private async readSettings(connection: Pick<PoolClient, 'query'>): Promise<VoiceReminderSettings> {
    const row = (await connection.query<SettingsRow>(settingsSql)).rows[0];
    if (!row) return { ...DEFAULT_VOICE_REMINDER_SETTINGS };
    const audio = row.audioId ? (await connection.query<AudioRow>(audioSql, [row.audioId])).rows[0] : null;
    const { audioId: _audioId, ...settings } = row;
    return { ...settings, timeZone: 'Asia/Tashkent', audio: audio ? publicAudio(asAudio(audio)) : null };
  }

  settings() { return this.readSettings(this.pool); }

  async currentAudio(): Promise<StoredVoiceReminderAudio | null> {
    const setting = (await this.pool.query<{ audioId: string | null }>(
      `SELECT audio_id AS "audioId" FROM voice_reminder_settings WHERE id = 1`,
    )).rows[0];
    if (!setting?.audioId) return null;
    const row = (await this.pool.query<AudioRow>(audioSql, [setting.audioId])).rows[0];
    return row ? asAudio(row) : null;
  }

  async saveSettings(input: VoiceReminderSettingsInput, actorId: number): Promise<void> {
    await this.pool.query(`UPDATE voice_reminder_settings SET enabled = $1, lead_minutes = $2,
      max_attempts = $3, retry_minutes = $4, allowed_start_time = $5, allowed_end_time = $6,
      max_concurrent_calls = $7, updated_by = $8, updated_at = now() WHERE id = 1`, [
      input.enabled, input.leadMinutes, input.maxAttempts, input.retryMinutes,
      input.allowedStartTime, input.allowedEndTime, input.maxConcurrentCalls, actorId,
    ]);
  }

  async saveAudio(audio: StoredVoiceReminderAudio, actorId: number): Promise<void> {
    await this.transaction(async connection => {
      await connection.query(`INSERT INTO voice_reminder_audio
        (id, file_name, mime_type, size_bytes, duration_seconds, storage_key, sha256, uploaded_by, uploaded_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        audio.id, audio.fileName, audio.mimeType, audio.sizeBytes, audio.durationSeconds,
        audio.storageKey, audio.sha256, actorId, audio.uploadedAt,
      ]);
      await connection.query(`UPDATE voice_reminder_settings SET audio_id = $1, updated_by = $2,
        updated_at = now() WHERE id = 1`, [audio.id, actorId]);
    });
  }

  async results() {
    const counts = await this.pool.query<{ status: VoiceReminderStatus; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM voice_reminder_jobs GROUP BY status`,
    );
    const summary = Object.fromEntries(VOICE_REMINDER_STATUSES.map(status => [status, 0])) as Record<VoiceReminderStatus, number>;
    for (const row of counts.rows) summary[row.status] = row.count;
    const rows = await this.pool.query<Omit<VoiceReminderResult, 'scheduledAt' | 'dueAt' | 'lastCallAt' | 'completedAt'> & {
      scheduledAt: Date; dueAt: Date; lastCallAt: Date | null; completedAt: Date | null;
    }>(`SELECT job.id::int AS id, job.demo_lesson_id AS "demoLessonId", job.participant_id AS "participantId",
      COALESCE(student.student_name, student.contact_name) AS "studentName", COALESCE(job.phone, '') AS phone,
      job.scheduled_at AS "scheduledAt", GREATEST(job.due_at, COALESCE(job.not_before_at, job.due_at)) AS "dueAt", job.status, job.attempts,
      job.last_call_at AS "lastCallAt", job.completed_at AS "completedAt"
      FROM voice_reminder_jobs job
      JOIN academy_demo_lesson_participants participant ON participant.id = job.participant_id
      JOIN academy_students student ON student.id = participant.student_id
      ORDER BY job.updated_at DESC, job.id DESC LIMIT 100`);
    const results = rows.rows.map(row => ({
      ...row, scheduledAt: row.scheduledAt.toISOString(), dueAt: row.dueAt.toISOString(),
      lastCallAt: row.lastCallAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null,
    }));
    return { summary, results };
  }

  async synchronize(now: Date, settings: VoiceReminderSettings): Promise<void> {
    await this.transaction(async connection => {
      // Expired in-flight work is ambiguous after a crash. It is terminal until
      // an operator reconciles it; automatic retries only follow a known no-answer.
      await connection.query(`UPDATE voice_reminder_jobs SET status = 'failed', lease_token = NULL,
        lease_until = NULL, completed_at = $1, updated_at = $1
        WHERE status = 'calling' AND lease_until <= $1`, [now]);
      await connection.query(`UPDATE voice_reminder_jobs job SET status = 'cancelled', completed_at = $1, updated_at = $1
        WHERE job.status = 'waiting' AND (job.scheduled_at <= $1 OR NOT EXISTS (
          SELECT 1 FROM academy_demo_lessons demo
          JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
          JOIN academy_students student ON student.id = participant.student_id
          LEFT JOIN academy_leads lead ON lead.id = student.lead_id
          WHERE demo.id = job.demo_lesson_id AND participant.id = job.participant_id
            AND demo.status = 'scheduled' AND demo.scheduled_at AT TIME ZONE 'UTC' = job.scheduled_at
            AND demo.voice_reminder_revision = job.lesson_revision
            AND participant.voice_reminder_revision = job.participant_revision
            AND participant.status IN ('invited', 'confirmed')
            AND (student.lead_id IS NULL OR (lead.id IS NOT NULL AND lead.is_archived = false))))`, [now]);
      if (!settings.enabled || !settings.audio) return;
      await connection.query(`INSERT INTO voice_reminder_jobs
        (demo_lesson_id, participant_id, scheduled_at, due_at, lesson_revision, participant_revision)
        SELECT demo.id, participant.id, demo.scheduled_at AT TIME ZONE 'UTC',
          (demo.scheduled_at AT TIME ZONE 'UTC') - ($2 * interval '1 minute'),
          demo.voice_reminder_revision, participant.voice_reminder_revision
        FROM academy_demo_lessons demo
        JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
        JOIN academy_students student ON student.id = participant.student_id
        LEFT JOIN academy_leads lead ON lead.id = student.lead_id
        WHERE demo.status = 'scheduled' AND demo.scheduled_at AT TIME ZONE 'UTC' > $1
          AND demo.scheduled_at AT TIME ZONE 'UTC' <= $1 + interval '30 days'
          AND participant.status IN ('invited', 'confirmed')
          AND (student.lead_id IS NULL OR (lead.id IS NOT NULL AND lead.is_archived = false))
        ON CONFLICT (demo_lesson_id, participant_id, scheduled_at, lesson_revision, participant_revision) DO NOTHING`, [now, settings.leadMinutes]);
      await connection.query(`UPDATE voice_reminder_jobs SET due_at = scheduled_at - ($1 * interval '1 minute')
        WHERE status = 'waiting' AND attempts = 0`, [settings.leadMinutes]);
    });
  }

  async claim(now: Date, maximum: number, leaseSeconds: number): Promise<ClaimedVoiceReminder | null> {
    return this.transaction(async connection => {
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext('voice-reminder-jobs'))`);
      const active = (await connection.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM voice_reminder_jobs WHERE status = 'calling' AND lease_until > $1`, [now],
      )).rows[0].count;
      if (active >= Math.min(2, maximum)) return null;
      const token = crypto.randomUUID();
      const row = (await connection.query<{ id: string; scheduledAt: Date; attempts: number }>(
        `UPDATE voice_reminder_jobs job SET status = 'calling', lease_token = $2, not_before_at = NULL,
          lease_until = $1::timestamptz + ($3 * interval '1 second'), updated_at = $1
         WHERE job.id = (SELECT id FROM voice_reminder_jobs WHERE status = 'waiting'
           AND due_at <= $1 AND (not_before_at IS NULL OR not_before_at <= $1)
           AND scheduled_at > $1 ORDER BY scheduled_at, due_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING id, scheduled_at AS "scheduledAt", attempts`, [now, token, leaseSeconds],
      )).rows[0];
      return row ? { id: Number(row.id), scheduledAt: row.scheduledAt, attempts: row.attempts, leaseToken: token } : null;
    });
  }

  async prepare(job: ClaimedVoiceReminder, now: Date): Promise<PreparedVoiceReminder | 'defer' | null> {
    return this.transaction(async connection => {
      const row = (await connection.query<LiveJobRow>(`${liveJobSql} FOR UPDATE OF job`, [job.id, job.leaseToken, now])).rows[0];
      const settings = await this.readSettings(connection);
      const phone = row ? currentPhone(row) : null;
      if (!row?.valid || !phone) return null;
      if (!settings.enabled || !settings.audio || row.attempts >= settings.maxAttempts
        || !reminderWithinAllowedHours(now, settings)) return 'defer';
      const audioRow = (await connection.query<AudioRow>(audioSql, [settings.audio.id])).rows[0];
      if (!audioRow) return null;
      await connection.query(`UPDATE voice_reminder_jobs SET phone = $3, audio_id = $4
        WHERE id = $1 AND lease_token = $2`, [job.id, job.leaseToken, phone, audioRow.id]);
      return { ...job, phone, audio: asAudio(audioRow) };
    });
  }

  async canContinue(job: ClaimedVoiceReminder, phone: string, now: Date): Promise<boolean> {
    const [live, settings] = await Promise.all([
      this.pool.query<LiveJobRow>(liveJobSql, [job.id, job.leaseToken, now]),
      this.settings(),
    ]);
    const row = live.rows[0];
    return Boolean(row?.valid && currentPhone(row) === phone && settings.enabled && settings.audio
      && row.attempts < settings.maxAttempts && reminderWithinAllowedHours(now, settings));
  }

  async renew(job: ClaimedVoiceReminder, now: Date, leaseSeconds: number): Promise<boolean> {
    const result = await this.pool.query(`UPDATE voice_reminder_jobs SET lease_until = $3::timestamptz + ($4 * interval '1 second')
      WHERE id = $1 AND lease_token = $2 AND status = 'calling' AND lease_until > $3`,
    [job.id, job.leaseToken, now, leaseSeconds]);
    return result.rowCount === 1;
  }

  async finish(job: ClaimedVoiceReminder, result: VoiceReminderCallResult, now: Date, retryAt: Date | null): Promise<void> {
    if (result.outcome === 'busy') return this.defer(job, now);
    const retry = result.outcome === 'unanswered' && retryAt !== null;
    const status = retry ? 'waiting' : result.outcome;
    await this.pool.query(`UPDATE voice_reminder_jobs SET status = $3::text,
      attempts = attempts + $4::integer, due_at = COALESCE($5::timestamptz, due_at),
      last_call_at = CASE WHEN $4::integer = 1 THEN $6::timestamptz ELSE last_call_at END,
      completed_at = CASE WHEN $3::text = 'waiting' THEN NULL ELSE $6::timestamptz END,
      provider_call_id = COALESCE(provider_call_id, $7), not_before_at = NULL,
      lease_token = NULL, lease_until = NULL, updated_at = $6::timestamptz
      WHERE id = $1 AND lease_token = $2 AND status = 'calling'`, [
      job.id, job.leaseToken, status, result.callStarted ? 1 : 0, retryAt, now, result.callId?.slice(0, 160) ?? null,
    ]);
  }

  async defer(job: ClaimedVoiceReminder, now: Date): Promise<void> {
    await this.pool.query(`UPDATE voice_reminder_jobs SET status = 'waiting', due_at = $3::timestamptz + interval '30 seconds',
      not_before_at = $3::timestamptz + interval '30 seconds',
      lease_token = NULL, lease_until = NULL, updated_at = $3
      WHERE id = $1 AND lease_token = $2 AND status = 'calling'`, [job.id, job.leaseToken, now]);
  }
}
