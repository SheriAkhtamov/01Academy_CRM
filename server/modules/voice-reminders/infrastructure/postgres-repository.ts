import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  DEFAULT_VOICE_REMINDER_SETTINGS,
  hasVoiceReminderAudioLibrary,
  hasVoiceReminderConfirmationAudio,
  voiceReminderResponseSchema,
  voiceReminderAudioIdSchema,
  selectVoiceReminderAudioParts,
  voiceReminderAudioDurationValid,
  type VoiceReminderKind,
  type VoiceReminderResponse,
  type VoiceReminderSettings,
  type VoiceReminderSettingsInput,
} from '@shared/contracts/voice-reminders';
import { normalizeReminderPhone, reminderWithinAllowedHours, reminderOnEligibleDay, reminderDeadline, reminderKindEnabled, VoiceReminderError } from '../domain/policy';
import type {
  ClaimedVoiceReminder,
  PreparedVoiceReminder,
  StoredVoiceReminderAudio,
  StoredVoiceReminderAudioLibrary,
  VoiceReminderAudioTarget,
  VoiceReminderLibraryEntryTarget,
  VoiceReminderCallResult,
  VoiceReminderRepository,
} from '../application/ports';
import { libraryAudioFor, validateAudioTarget, withLibraryAudio } from '../application/audio-library';

type SettingsRow = VoiceReminderSettingsInput & { audioId: string | null; introAudioId: string | null; dayBeforeIntroAudioId: string | null; outroAudioId: string | null; confirmationYesAudioId: string | null; confirmationNoAudioId: string | null };
type AudioRow = Omit<StoredVoiceReminderAudio, 'uploadedAt'> & { uploadedAt: Date };
type LiveJobRow = {
  id: string;
  leaseToken: string;
  leaseUntil: Date;
  scheduledAt: Date;
  attempts: number;
  reminderKind: VoiceReminderKind;
  phone: string | null;
  studentPhone: string | null;
  primaryPhone: string | null;
  leadPhone: string | null;
  introAudioId: string | null;
  timeAudioId: string | null;
  outroAudioId: string | null;
  audioClockTime: string | null;
  audioMode: 'time' | 'clock' | null;
  hourAudioId: string | null;
  minuteAudioId: string | null;
  confirmationEnabled: boolean;
  confirmationYesAudioId: string | null;
  confirmationNoAudioId: string | null;
  providerCallId: string | null;
  response: VoiceReminderResponse | null;
  responseLessonRevision: number;
  responseParticipantRevision: number;
  valid: boolean;
};

const settingsSql = `SELECT enabled,confirmation_enabled AS "confirmationEnabled",
  confirmation_yes_audio_id AS "confirmationYesAudioId",confirmation_no_audio_id AS "confirmationNoAudioId", lead_minutes AS "leadMinutes", max_attempts AS "maxAttempts",
  day_before_enabled AS "dayBeforeEnabled",day_before_start_time AS "dayBeforeStartTime",day_before_end_time AS "dayBeforeEndTime",
  retry_minutes AS "retryMinutes", allowed_start_time AS "allowedStartTime",
  allowed_end_time AS "allowedEndTime", max_concurrent_calls AS "maxConcurrentCalls", audio_id AS "audioId",
  day_before_intro_audio_id AS "dayBeforeIntroAudioId",intro_audio_id AS "introAudioId", outro_audio_id AS "outroAudioId"
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
  job.confirmation_enabled AS "confirmationEnabled",job.confirmation_yes_audio_id AS "confirmationYesAudioId",
  job.confirmation_no_audio_id AS "confirmationNoAudioId",job.provider_call_id AS "providerCallId",job.response,
  job.scheduled_at AS "scheduledAt", job.attempts, job.reminder_kind AS "reminderKind", job.phone,
  job.intro_audio_id AS "introAudioId", job.time_audio_id AS "timeAudioId", job.outro_audio_id AS "outroAudioId",
  job.audio_clock_time AS "audioClockTime",
  job.audio_mode AS "audioMode", job.hour_audio_id AS "hourAudioId", job.minute_audio_id AS "minuteAudioId",
  demo.voice_response_revision AS "responseLessonRevision",participant.voice_response_revision AS "responseParticipantRevision",
  student.phone AS "studentPhone", lead.phone AS "leadPhone",
  (SELECT phone.phone FROM academy_lead_phones phone WHERE phone.lead_id = lead.id
   AND trim(phone.phone) ~ '^[+]?[0-9[:space:]().-]+$'
   AND (length(regexp_replace(phone.phone, '[^0-9]', '', 'g'))=9
     OR regexp_replace(regexp_replace(phone.phone, '[^0-9]', '', 'g'), '^00', '') ~ '^[1-9][0-9]{7,14}$')
   ORDER BY phone.is_primary DESC NULLS LAST, phone.id LIMIT 1) AS "primaryPhone",
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
const currentPhone = (row: LiveJobRow) => normalizeReminderPhone(row.primaryPhone)
  ?? normalizeReminderPhone(row.leadPhone)
  ?? normalizeReminderPhone(row.studentPhone);
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const clockTime = (date: Date) => clockFormatter.format(date);
const entryStorage = (target: VoiceReminderLibraryEntryTarget) => {
  switch (target.part) {
    case 'hour': return { table: 'voice_reminder_hour_audio', column: 'hour', value: target.hour };
    case 'minute': return { table: 'voice_reminder_minute_audio', column: 'minute', value: target.minute };
    case 'time': return { table: 'voice_reminder_time_audio', column: 'time', value: target.time };
  }
};

export const readVoiceReminderAudioLibrary = async (connection: Pick<PoolClient, 'query'>): Promise<StoredVoiceReminderAudioLibrary> => {
  const row = (await connection.query<{ introAudioId: string | null; dayBeforeIntroAudioId: string | null; outroAudioId: string | null; confirmationYesAudioId: string | null; confirmationNoAudioId: string | null }>(
    `SELECT confirmation_yes_audio_id AS "confirmationYesAudioId",confirmation_no_audio_id AS "confirmationNoAudioId",day_before_intro_audio_id AS "dayBeforeIntroAudioId",intro_audio_id AS "introAudioId",outro_audio_id AS "outroAudioId" FROM voice_reminder_settings WHERE id=1`,
  )).rows[0];
  const part = async (id: string | null | undefined) => {
    if (!id) return null;
    const audio = (await connection.query<AudioRow>(audioSql, [id])).rows[0];
    return audio ? asAudio(audio) : null;
  };
  const intro = await part(row?.introAudioId);
  const outro = await part(row?.outroAudioId);
  const dayBeforeIntro = await part(row?.dayBeforeIntroAudioId);
  const confirmationYes = await part(row?.confirmationYesAudioId);
  const confirmationNo = await part(row?.confirmationNoAudioId);
  const entries = (await connection.query<AudioRow & { part: 'time' | 'hour' | 'minute'; audioIndex: string }>(
    `SELECT entry.part,entry.audio_index AS "audioIndex",audio.id,audio.file_name AS "fileName",
    audio.mime_type AS "mimeType",audio.size_bytes AS "sizeBytes",audio.duration_seconds AS "durationSeconds",
    audio.storage_key AS "storageKey",audio.sha256,audio.uploaded_at AS "uploadedAt"
    FROM (SELECT 'time' AS part,time AS audio_index,audio_id FROM voice_reminder_time_audio
      UNION ALL SELECT 'hour',hour,audio_id FROM voice_reminder_hour_audio
      UNION ALL SELECT 'minute',minute,audio_id FROM voice_reminder_minute_audio) entry
    JOIN voice_reminder_audio audio ON audio.id=entry.audio_id ORDER BY entry.part,entry.audio_index`)).rows;
  const library: StoredVoiceReminderAudioLibrary = { intro, dayBeforeIntro, outro, confirmationYes, confirmationNo, times: [], hours: [], minutes: [] };
  for (const { part: entryPart, audioIndex, ...rowAudio } of entries) {
    const audio = asAudio(rowAudio);
    if (entryPart === 'time') library.times.push({ time: audioIndex, audio });
    else if (entryPart === 'hour') library.hours.push({ hour: audioIndex, audio });
    else library.minutes.push({ minute: audioIndex, audio });
  }
  return library;
};

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
    const library = await readVoiceReminderAudioLibrary(connection);
    const { audioId: _audioId, introAudioId: _introId, dayBeforeIntroAudioId: _dayBeforeIntroId, outroAudioId: _outroId, confirmationYesAudioId: _yesId, confirmationNoAudioId: _noId, ...settings } = row;
    return { ...settings, timeZone: 'Asia/Tashkent', audio: audio ? publicAudio(asAudio(audio)) : null,
      audioLibrary: { intro: library.intro ? publicAudio(library.intro) : null,
        dayBeforeIntro: library.dayBeforeIntro ? publicAudio(library.dayBeforeIntro) : null,
        outro: library.outro ? publicAudio(library.outro) : null,
        confirmationYes: library.confirmationYes ? publicAudio(library.confirmationYes) : null,
        confirmationNo: library.confirmationNo ? publicAudio(library.confirmationNo) : null,
        times: library.times.map(entry => ({ time: entry.time, audio: publicAudio(entry.audio) })),
        hours: library.hours.map(entry => ({ hour: entry.hour, audio: publicAudio(entry.audio) })),
        minutes: library.minutes.map(entry => ({ minute: entry.minute, audio: publicAudio(entry.audio) })) } };
  }


  audioLibrary() { return readVoiceReminderAudioLibrary(this.pool); }

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
    await this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR UPDATE');
      const library = await readVoiceReminderAudioLibrary(connection);
      if (input.enabled && (!hasVoiceReminderAudioLibrary(library) || (input.dayBeforeEnabled && !hasVoiceReminderAudioLibrary(library, 'day_before')))) throw new VoiceReminderError('voiceReminderAudioRequired', 409);
      if (input.confirmationEnabled && !hasVoiceReminderConfirmationAudio(library)) throw new VoiceReminderError('voiceReminderConfirmationAudioRequired', 409);
      if (!voiceReminderAudioDurationValid(library)) throw new VoiceReminderError('voiceReminderAudioTooLong', 400);
      await connection.query(`UPDATE voice_reminder_settings SET enabled = $1, lead_minutes = $2,
      max_attempts = $3, retry_minutes = $4, allowed_start_time = $5, allowed_end_time = $6,
      max_concurrent_calls = $7, updated_by = $8,
      day_before_enabled=$9,day_before_start_time=$10,day_before_end_time=$11,confirmation_enabled=$12, updated_at = now() WHERE id = 1`, [
      input.enabled, input.leadMinutes, input.maxAttempts, input.retryMinutes,
      input.allowedStartTime, input.allowedEndTime, input.maxConcurrentCalls, actorId,
      input.dayBeforeEnabled,input.dayBeforeStartTime,input.dayBeforeEndTime,input.confirmationEnabled,
      ]);
    });
  }

  async saveAudio(audio: StoredVoiceReminderAudio, actorId: number): Promise<void> {
    await this.transaction(async connection => {
      await this.insertAudio(connection, audio, actorId);
      await connection.query(`UPDATE voice_reminder_settings SET audio_id = $1, updated_by = $2,
        updated_at = now() WHERE id = 1`, [audio.id, actorId]);
    });
  }

  private async insertAudio(connection: PoolClient, audio: StoredVoiceReminderAudio, actorId: number) {
    await connection.query(`INSERT INTO voice_reminder_audio
        (id, file_name, mime_type, size_bytes, duration_seconds, storage_key, sha256, uploaded_by, uploaded_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        audio.id, audio.fileName, audio.mimeType, audio.sizeBytes, audio.durationSeconds,
        audio.storageKey, audio.sha256, actorId, audio.uploadedAt,
    ]);
  }

  async saveLibraryAudio(target: VoiceReminderAudioTarget, audio: StoredVoiceReminderAudio, actorId: number, expectedAudioId?: string | null): Promise<void> {
    validateAudioTarget(target);
    await this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR UPDATE');
      const library = await readVoiceReminderAudioLibrary(connection);
      const current = libraryAudioFor(library, target);
      if (expectedAudioId !== undefined && (current?.id ?? null) !== expectedAudioId) throw new VoiceReminderError('voiceReminderAudioChanged', 409);
      const candidate = withLibraryAudio(library, target, audio);
      if (!voiceReminderAudioDurationValid(candidate)) throw new VoiceReminderError('voiceReminderAudioTooLong', 400);
      await this.insertAudio(connection, audio, actorId);
      if (target.part === 'time' || target.part === 'hour' || target.part === 'minute') {
        const { table, column, value } = entryStorage(target);
        await connection.query(`INSERT INTO ${table}(${column},audio_id,updated_by) VALUES($1,$2,$3)
          ON CONFLICT(${column}) DO UPDATE SET audio_id=EXCLUDED.audio_id,updated_by=EXCLUDED.updated_by,updated_at=now()`, [value, audio.id, actorId]);
        await connection.query('UPDATE voice_reminder_settings SET updated_by=$1,updated_at=now() WHERE id=1', [actorId]);
      } else {
        const column = target.part === 'intro' ? 'intro_audio_id' : target.part === 'dayBeforeIntro' ? 'day_before_intro_audio_id'
          : target.part === 'confirmationYes' ? 'confirmation_yes_audio_id' : target.part === 'confirmationNo' ? 'confirmation_no_audio_id' : 'outro_audio_id';
        await connection.query(`UPDATE voice_reminder_settings SET ${column}=$1,updated_by=$2,updated_at=now() WHERE id=1`, [audio.id, actorId]);
      }
    });
  }

  async removeTimeAudio(time: string, actorId: number, expectedAudioId?: string): Promise<void> {
    return this.removeLibraryAudio({ part: 'time', time }, actorId, expectedAudioId);
  }

  async removeLibraryAudio(target: VoiceReminderLibraryEntryTarget, actorId: number, expectedAudioId?: string): Promise<void> {
    validateAudioTarget(target);
    const { table, column, value } = entryStorage(target);
    await this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR UPDATE');
      if (expectedAudioId !== undefined) {
        const current = (await connection.query<{ audioId: string }>(`SELECT audio_id AS "audioId" FROM ${table} WHERE ${column}=$1`, [value])).rows[0];
        if (current?.audioId !== expectedAudioId) throw new VoiceReminderError('voiceReminderAudioChanged', 409);
      }
      await connection.query('UPDATE voice_reminder_settings SET updated_by=$1,updated_at=now() WHERE id=1', [actorId]);
      await connection.query(`DELETE FROM ${table} WHERE ${column}=$1`, [value]);
    });
  }

  async synchronize(now: Date, settings: VoiceReminderSettings): Promise<void> {
    await this.transaction(async connection => {
      // Expired in-flight work is ambiguous after a crash. It is terminal until
      // an operator reconciles it; automatic retries only follow a known no-answer.
      await connection.query(`UPDATE voice_reminder_jobs SET status = 'failed', lease_token = NULL,
        lease_until = NULL, completed_at = $1, updated_at = $1
        WHERE status = 'calling' AND lease_until <= $1`, [now]);
      await connection.query(`UPDATE voice_reminder_jobs job SET status = 'cancelled', completed_at = $1, updated_at = $1
        WHERE job.status = 'waiting' AND (job.scheduled_at <= $1 OR (job.reminder_kind='day_before' AND
          ((job.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date - 1
            + (SELECT day_before_end_time::time FROM voice_reminder_settings WHERE id=1)) AT TIME ZONE 'Asia/Tashkent' <= $1) OR NOT EXISTS (
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
      if (!settings.enabled) return;
      await connection.query(`INSERT INTO voice_reminder_jobs
        (demo_lesson_id, participant_id, scheduled_at, due_at, lesson_revision, participant_revision, reminder_kind)
        SELECT demo.id, participant.id, demo.scheduled_at AT TIME ZONE 'UTC',
          CASE WHEN kind.reminder_kind='same_day' THEN (demo.scheduled_at AT TIME ZONE 'UTC') - ($2 * interval '1 minute')
            ELSE GREATEST(previous_day.day + $3::time, LEAST(
              demo.scheduled_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent' - interval '1 day',
              previous_day.day + $4::time - interval '1 minute')) AT TIME ZONE 'Asia/Tashkent' END,
          demo.voice_reminder_revision, participant.voice_reminder_revision,kind.reminder_kind
        FROM academy_demo_lessons demo
        CROSS JOIN (VALUES ('same_day'),('day_before')) kind(reminder_kind)
        CROSS JOIN LATERAL (SELECT (demo.scheduled_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date - 1 AS day) previous_day
        JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
        JOIN academy_students student ON student.id = participant.student_id
        LEFT JOIN academy_leads lead ON lead.id = student.lead_id
        WHERE demo.status = 'scheduled' AND demo.scheduled_at AT TIME ZONE 'UTC' > $1
          AND (kind.reminder_kind='same_day' OR $5::boolean)
          AND demo.scheduled_at AT TIME ZONE 'UTC' <= $1 + interval '30 days'
          AND participant.status IN ('invited', 'confirmed')
          AND (student.lead_id IS NULL OR (lead.id IS NOT NULL AND lead.is_archived = false))
        ON CONFLICT (demo_lesson_id, participant_id, scheduled_at, lesson_revision, participant_revision, reminder_kind) DO NOTHING`,
      [now,settings.leadMinutes,settings.dayBeforeStartTime,settings.dayBeforeEndTime,settings.dayBeforeEnabled]);
      await connection.query(`UPDATE voice_reminder_jobs SET due_at = CASE WHEN reminder_kind='same_day' THEN scheduled_at - ($1 * interval '1 minute')
        ELSE GREATEST((scheduled_at AT TIME ZONE 'Asia/Tashkent')::date - 1 + $2::time, LEAST(
          scheduled_at AT TIME ZONE 'Asia/Tashkent' - interval '1 day',
          (scheduled_at AT TIME ZONE 'Asia/Tashkent')::date - 1 + $3::time - interval '1 minute')) AT TIME ZONE 'Asia/Tashkent' END
        WHERE status = 'waiting' AND attempts = 0`, [settings.leadMinutes,settings.dayBeforeStartTime,settings.dayBeforeEndTime]);
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
      const row = (await connection.query<{ id: string; scheduledAt: Date; attempts: number; reminderKind: VoiceReminderKind }>(
        `UPDATE voice_reminder_jobs job SET status = 'calling', lease_token = $2, not_before_at = NULL,
          lease_until = $1::timestamptz + ($3 * interval '1 second'), updated_at = $1
         WHERE job.id = (SELECT pending.id FROM voice_reminder_jobs pending
           CROSS JOIN voice_reminder_settings settings
           LEFT JOIN voice_reminder_time_audio time_audio ON time_audio.time=to_char(pending.scheduled_at AT TIME ZONE 'Asia/Tashkent','HH24:MI')
           LEFT JOIN voice_reminder_hour_audio hour_audio ON hour_audio.hour=to_char(pending.scheduled_at AT TIME ZONE 'Asia/Tashkent','HH24')
           LEFT JOIN voice_reminder_minute_audio minute_audio ON minute_audio.minute=to_char(pending.scheduled_at AT TIME ZONE 'Asia/Tashkent','MI')
           WHERE pending.status = 'waiting' AND settings.id=1 AND settings.enabled
           AND (CASE WHEN pending.reminder_kind='day_before' THEN settings.day_before_intro_audio_id ELSE settings.intro_audio_id END) IS NOT NULL
           AND (NOT settings.confirmation_enabled OR (settings.confirmation_yes_audio_id IS NOT NULL AND settings.confirmation_no_audio_id IS NOT NULL))
           AND settings.outro_audio_id IS NOT NULL AND pending.attempts<settings.max_attempts
           AND (time_audio.audio_id IS NOT NULL OR (hour_audio.audio_id IS NOT NULL AND minute_audio.audio_id IS NOT NULL))
           AND pending.due_at <= $1 AND (pending.not_before_at IS NULL OR pending.not_before_at <= $1)
           AND pending.scheduled_at > $1
           AND (
             (pending.reminder_kind='same_day' AND (pending.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date = ($1::timestamptz AT TIME ZONE 'Asia/Tashkent')::date
               AND to_char($1::timestamptz AT TIME ZONE 'Asia/Tashkent','HH24:MI')>=settings.allowed_start_time
               AND to_char($1::timestamptz AT TIME ZONE 'Asia/Tashkent','HH24:MI')<settings.allowed_end_time)
             OR (pending.reminder_kind='day_before' AND settings.day_before_enabled
               AND (pending.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date - 1 = ($1::timestamptz AT TIME ZONE 'Asia/Tashkent')::date
               AND to_char($1::timestamptz AT TIME ZONE 'Asia/Tashkent','HH24:MI')>=settings.day_before_start_time
               AND to_char($1::timestamptz AT TIME ZONE 'Asia/Tashkent','HH24:MI')<settings.day_before_end_time))
           ORDER BY pending.scheduled_at,pending.due_at,pending.id FOR UPDATE OF pending SKIP LOCKED LIMIT 1)
         RETURNING id, scheduled_at AS "scheduledAt", attempts, reminder_kind AS "reminderKind"`, [now, token, leaseSeconds],
      )).rows[0];
      return row ? { id: Number(row.id), scheduledAt: row.scheduledAt, attempts: row.attempts, reminderKind: row.reminderKind, leaseToken: token } : null;
    });
  }

  async prepare(job: ClaimedVoiceReminder, now: Date): Promise<PreparedVoiceReminder | 'defer' | null> {
    return this.transaction(async connection => {
      const row = (await connection.query<LiveJobRow>(`${liveJobSql} FOR UPDATE OF job`, [job.id, job.leaseToken, now])).rows[0];
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR SHARE');
      const settings = await this.readSettings(connection);
      const phone = row ? currentPhone(row) : null;
      if (!row?.valid || !phone) return null;
      if (!reminderKindEnabled(settings,row.reminderKind) || !reminderOnEligibleDay(row.scheduledAt,now,row.reminderKind) || row.attempts >= settings.maxAttempts
        || !reminderWithinAllowedHours(now,settings,row.reminderKind)) return 'defer';
      const library = await readVoiceReminderAudioLibrary(connection);
      const parts = selectVoiceReminderAudioParts(library,clockTime(row.scheduledAt),row.reminderKind);
      if (!parts || !voiceReminderAudioDurationValid(library) || (settings.confirmationEnabled && !hasVoiceReminderConfirmationAudio(library))) return 'defer';
      await connection.query(`UPDATE voice_reminder_jobs SET phone=$3,intro_audio_id=$4,time_audio_id=$5,outro_audio_id=$6,audio_clock_time=$7,
        audio_mode=$8,hour_audio_id=$9,minute_audio_id=$10,confirmation_enabled=$11,
        confirmation_yes_audio_id=$12,confirmation_no_audio_id=$13 WHERE id=$1 AND lease_token=$2`, [
        job.id, job.leaseToken, phone, parts.intro.id, parts.kind === 'time' ? parts.time.id : null,
        parts.outro.id, parts.clockTime, parts.kind, parts.kind === 'clock' ? parts.hour.id : null,
        parts.kind === 'clock' ? parts.minute.id : null,settings.confirmationEnabled,
        settings.confirmationEnabled ? library.confirmationYes!.id : null,settings.confirmationEnabled ? library.confirmationNo!.id : null,
      ]);
      const confirmation = settings.confirmationEnabled ? { yesAudio: library.confirmationYes!, noAudio: library.confirmationNo!, promptDurationSeconds: parts.outro.durationSeconds } : null;
      return { ...job, reminderKind: row.reminderKind, phone, audioParts: parts, confirmation, deadline: reminderDeadline(row.scheduledAt,settings,row.reminderKind) };
    });
  }

  async canContinue(job: ClaimedVoiceReminder, phone: string, now: Date, verifyAudio = true): Promise<boolean> {
    return this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR SHARE');
      const row = (await connection.query<LiveJobRow>(liveJobSql, [job.id,job.leaseToken,now])).rows[0];
      const settings = await this.readSettings(connection);
      const library = await readVoiceReminderAudioLibrary(connection);
      const parts = row ? selectVoiceReminderAudioParts(library,clockTime(row.scheduledAt),row.reminderKind) : null;
      const eligible = row?.valid && row.reminderKind === job.reminderKind && reminderOnEligibleDay(row.scheduledAt,now,row.reminderKind)
        && currentPhone(row)===phone && reminderKindEnabled(settings,row.reminderKind)
        && row.attempts<settings.maxAttempts && reminderWithinAllowedHours(now,settings,row.reminderKind);
      if (!eligible || row.confirmationEnabled !== settings.confirmationEnabled) return false;
      if (!verifyAudio) return true;
      if (row.confirmationEnabled && (row.confirmationYesAudioId !== library.confirmationYes?.id || row.confirmationNoAudioId !== library.confirmationNo?.id)) return false;
      if (!parts || !voiceReminderAudioDurationValid(library) || parts.kind !== row.audioMode
        || parts.intro.id !== row.introAudioId || parts.outro.id !== row.outroAudioId || parts.clockTime !== row.audioClockTime) return false;
      return parts.kind === 'time' ? parts.time.id === row.timeAudioId
        : parts.hour.id === row.hourAudioId && parts.minute.id === row.minuteAudioId;
    });
  }

  async recordResponse(job: ClaimedVoiceReminder, phone: string, response: VoiceReminderResponse, now: Date, callId: string): Promise<boolean> {
    if (!voiceReminderResponseSchema.safeParse(response).success || !voiceReminderAudioIdSchema.safeParse(callId).success) return false;
    return this.transaction(async connection => {
      await connection.query('SELECT id FROM voice_reminder_settings WHERE id=1 FOR SHARE');
      const identity = (await connection.query<{ demoId: number; participantId: number }>(
        `SELECT demo_lesson_id AS "demoId",participant_id AS "participantId" FROM voice_reminder_jobs WHERE id=$1 AND lease_token=$2`,
        [job.id,job.leaseToken],
      )).rows[0];
      if (!identity) return false;
      // Lock mutable domain rows before the job; cancellation triggers acquire
      // the job lock after their lesson/participant mutation.
      await connection.query('SELECT id FROM academy_demo_lessons WHERE id=$1 FOR SHARE', [identity.demoId]);
      await connection.query('SELECT id FROM academy_demo_lesson_participants WHERE id=$1 FOR SHARE', [identity.participantId]);
      const ownAttempt = await connection.query<{ providerId: string | null }>(`SELECT provider_id AS "providerId" FROM voice_reminder_call_attempts
        WHERE call_id=$1::uuid AND job_id=$2 AND phone=$3 AND completed_at IS NULL AND termination_confirmed_at IS NULL FOR SHARE`, [callId,job.id,phone]);
      if (!ownAttempt.rowCount) return false;
      await connection.query('SELECT id FROM voice_reminder_jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE', [job.id,job.leaseToken]);
      const effectiveNow = (await connection.query<{ now: Date }>('SELECT GREATEST($1::timestamptz,clock_timestamp()) AS now', [now])).rows[0].now;
      const row = (await connection.query<LiveJobRow>(`${liveJobSql} FOR UPDATE OF job`, [job.id,job.leaseToken,effectiveNow])).rows[0];
      const settings = await this.readSettings(connection);
      const boundProviderId = ownAttempt.rows[0].providerId;
      const sameCall = row?.providerCallId===callId || Boolean(boundProviderId && row?.providerCallId===boundProviderId);
      if (!row?.valid || currentPhone(row)!==phone || row.phone!==phone || !sameCall
        || !row.confirmationEnabled || !settings.confirmationEnabled || row.reminderKind!==job.reminderKind
        || !reminderKindEnabled(settings,row.reminderKind) || !reminderOnEligibleDay(row.scheduledAt,effectiveNow,row.reminderKind)
        || !reminderWithinAllowedHours(effectiveNow,settings,row.reminderKind)) return false;
      if (row.response) return row.response===response;
      const saved = await connection.query(`UPDATE voice_reminder_jobs SET response=$3,response_at=$4,response_call_id=$5,updated_at=$4,
        response_lesson_revision=$6,response_participant_revision=$7
        WHERE id=$1 AND lease_token=$2 AND status='calling' AND response IS NULL`, [job.id,job.leaseToken,response,effectiveNow,callId,row.responseLessonRevision,row.responseParticipantRevision]);
      return saved.rowCount===1;
    });
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
