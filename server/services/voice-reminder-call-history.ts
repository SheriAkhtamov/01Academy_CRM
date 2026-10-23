import type { Pool, PoolClient } from 'pg';
import type { VoiceReminderCallResult } from '../modules/voice-reminders/application/ports';
import { normalizeReminderPhone } from '../modules/voice-reminders/domain/policy';
import { onlinePbxClient, type OnlinePbxCallHistoryItem } from './onlinepbx';
import { LocalVoiceReminderRecordingArchive } from './voice-reminder-recording-archive';
import { logger } from '../lib/logger';
import { appConfig } from '../config';
import { pool } from '../db';
import { canAccessAcademyModule, hasLeadershipAccess } from '@shared/academy';
import { telephonyReminderHistoryCondition, type TelephonyNotificationViewer } from './telephony-notifications';

type Queryable = Pick<Pool | PoolClient, 'query'>;
export type ReminderCallCompletion = Pick<VoiceReminderCallResult, 'outcome' | 'response' | 'reason' | 'endCause'> & { answeredAt?: Date | null };
export type ReminderHistoryRow = {
  callId: string; leadId: number; phone: string; extension: string; providerId: string | null;
  startedAt: Date; status: string; answeredAt: Date | null; endedAt: Date | null;
  talkSeconds: number; recordingUrl: string | null; recordingProviderId: string | null;
  recordingStorageKey: string | null; recordingMimeType: string | null;
  reminderResponse?: 'yes' | 'no' | null;
};

export const captureVoiceReminderCallDetails = async (connection: Queryable, callId: string) => {
  const inserted=await connection.query(`INSERT INTO voice_reminder_call_details(call_id,lead_id,student_id,participant_id)
    SELECT attempt.call_id,student.lead_id,student.id,participant.id
    FROM voice_reminder_call_attempts attempt JOIN voice_reminder_jobs job ON job.id=attempt.job_id
    JOIN academy_demo_lesson_participants participant ON participant.id=job.participant_id
      AND participant.demo_lesson_id=job.demo_lesson_id
    JOIN academy_students student ON student.id=participant.student_id
    WHERE attempt.call_id=$1::uuid AND job.phone=attempt.phone
      AND job.delivery_lesson_revision=(SELECT voice_response_revision FROM academy_demo_lessons WHERE id=job.demo_lesson_id)
      AND job.delivery_participant_revision=participant.voice_response_revision
      AND attempt.phone=voice_reminder_contact_phone(student.id)
    ON CONFLICT(call_id) DO NOTHING RETURNING call_id`, [callId]);
  return inserted.rowCount===1;
};

export const completeVoiceReminderCallDetails = async (
  connection: Queryable, callId: string, result: ReminderCallCompletion,
) => {
  await connection.query(`UPDATE voice_reminder_call_details detail SET
    status=CASE WHEN COALESCE(detail.answered_at,$3::timestamptz) IS NOT NULL THEN 'ended' ELSE 'failed' END,
    answered_at=COALESCE(detail.answered_at,$3::timestamptz),ended_at=COALESCE(detail.ended_at,now()),
    duration_seconds=GREATEST(detail.duration_seconds,FLOOR(EXTRACT(EPOCH FROM now()-attempt.started_at))::integer,0),
    talk_seconds=GREATEST(detail.talk_seconds,COALESCE(FLOOR(EXTRACT(EPOCH FROM now()-$3::timestamptz))::integer,0),0),
    reminder_outcome=COALESCE(detail.reminder_outcome,$2),
    reminder_response=COALESCE(detail.reminder_response,$4),
    reminder_reason=COALESCE(detail.reminder_reason,$5),hangup_cause=COALESCE(detail.hangup_cause,$6),updated_at=now()
    FROM voice_reminder_call_attempts attempt WHERE detail.call_id=$1::uuid AND attempt.call_id=detail.call_id`,
  [callId,result.outcome,result.answeredAt ?? null,result.response ?? null,result.reason ?? null,result.endCause ?? null]);
};

export const reminderCallHistoryColumns = `attempt.call_id AS "callId",detail.lead_id AS "leadId",
  attempt.phone,attempt.extension,attempt.provider_id AS "providerId",attempt.started_at AS "startedAt",
  detail.status,detail.answered_at AS "answeredAt",detail.ended_at AS "endedAt",detail.talk_seconds AS "talkSeconds",
  detail.recording_url AS "recordingUrl",detail.recording_provider_id AS "recordingProviderId",
  detail.recording_storage_key AS "recordingStorageKey",detail.recording_mime_type AS "recordingMimeType",
  detail.reminder_response AS "reminderResponse"`;

const outgoing = (value: string) => ['out','outgoing','outbound'].includes(value.toLowerCase());
export const matchesReminderRecordingIdentity = (row: ReminderHistoryRow, history: OnlinePbxCallHistoryItem) => {
  const numbers = [history.callerIdNumber,history.destinationNumber,...history.events.map(event => event.number)];
  return history.uuid===(row.providerId ?? row.callId) && outgoing(history.direction)
    && Math.abs(history.startStamp*1_000-new Date(row.startedAt).getTime())<=5_000
    && numbers.some(number => normalizeReminderPhone(String(number ?? ''))===row.phone)
    && numbers.some(number => String(number ?? '').trim()===row.extension);
};

type RecordingClient = Pick<typeof onlinePbxClient, 'getCallHistory' | 'getCallRecordingUrl'>;
type RecordingArchive = Pick<LocalVoiceReminderRecordingArchive, 'save' | 'resolve'>;
export class VoiceReminderCallHistory {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly inFlight = new Map<string,Promise<ReminderHistoryRow | null>>();
  constructor(
    private readonly database: Queryable = pool,
    private readonly client: RecordingClient = onlinePbxClient,
    readonly archive: RecordingArchive = new LocalVoiceReminderRecordingArchive({
      allowedOrigin:new URL(appConfig.integrations?.onlinePbx?.apiUrl || 'https://api2.onlinepbx.ru').origin,
    }),
  ) {}

  async read(callId: string): Promise<ReminderHistoryRow | null> {
    return (await this.database.query<ReminderHistoryRow>(`SELECT ${reminderCallHistoryColumns}
      FROM voice_reminder_call_details detail JOIN voice_reminder_call_attempts attempt ON attempt.call_id=detail.call_id
      WHERE detail.call_id=$1::uuid`, [callId])).rows[0] ?? null;
  }

  async readAuthorized(callId: string,viewer: TelephonyNotificationViewer): Promise<ReminderHistoryRow | null> {
    if (!hasLeadershipAccess(viewer) && !canAccessAcademyModule(viewer,'sales')) return null;
    const visibility=telephonyReminderHistoryCondition(viewer,'$2');
    return (await this.database.query<ReminderHistoryRow>(`SELECT ${reminderCallHistoryColumns}
      FROM voice_reminder_call_details detail JOIN voice_reminder_call_attempts attempt ON attempt.call_id=detail.call_id
      JOIN academy_leads lead ON lead.id=detail.lead_id
      WHERE detail.call_id=$1::uuid AND ${visibility}`,hasLeadershipAccess(viewer) ? [callId] : [callId,viewer.id])).rows[0] ?? null;
  }

  hydrate(callId: string): Promise<ReminderHistoryRow | null> {
    const pending = this.inFlight.get(callId);
    if (pending) return pending;
    const work = this.hydrateOnce(callId).finally(() => this.inFlight.delete(callId));
    this.inFlight.set(callId,work);
    return work;
  }

  private async hydrateOnce(callId: string): Promise<ReminderHistoryRow | null> {
    // A response may commit before a process interruption prevents completion.
    // Its native UUID is the only safe way to recover this per-attempt answer.
    await this.database.query(`UPDATE voice_reminder_call_details detail SET reminder_response=job.response,
      reminder_outcome='played',updated_at=now() FROM voice_reminder_call_attempts attempt
      JOIN voice_reminder_jobs job ON job.id=attempt.job_id
      WHERE detail.call_id=$1::uuid AND attempt.call_id=detail.call_id AND job.response IS NOT NULL
        AND job.response_call_id=attempt.call_id::text AND detail.reminder_response IS NULL`, [callId]);
    const row = await this.read(callId);
    if (!row || row.recordingStorageKey) return row;
    const providerId = row.providerId ?? row.callId;
    await this.database.query(`UPDATE voice_reminder_call_details SET recording_checked_at=now(),
      recording_attempts=recording_attempts+1 WHERE call_id=$1::uuid`, [callId]);
    const history = (await this.client.getCallHistory({ uuid:providerId })).filter(item => item.uuid===providerId);
    const match = history.length===1 && matchesReminderRecordingIdentity(row,history[0]) ? history[0] : null;
    if (!match) return row;
    const duration = Math.max(0,Math.min(86_400,Math.floor(match.duration)||0));
    const talk = Math.max(0,Math.min(duration,Math.floor(match.talkTime)||0));
    const endedAt = Number.isFinite(match.endStamp) && match.endStamp>match.startStamp
      && match.endStamp-match.startStamp<=86_400 ? new Date(match.endStamp*1_000) : null;
    // A partial CDR cannot authorize archiving a truncated conversation.
    if (!endedAt) return row;
    const providerAnswerStamp=match.events.filter(event => String(event.number ?? '')===row.extension)
      .map(event => Number(event.answered_stamp)).find(stamp => Number.isFinite(stamp) && stamp>=match.startStamp && stamp<=match.endStamp);
    const providerAnsweredAt=providerAnswerStamp ? new Date(providerAnswerStamp*1_000) : null;
    const answered=Boolean(talk>0 || row.answeredAt || row.reminderResponse || providerAnsweredAt);
    const url = answered ? await this.client.getCallRecordingUrl(providerId) : null;
    const updated = await this.database.query(`UPDATE voice_reminder_call_details detail SET
      status=CASE WHEN $3::integer>0 OR detail.answered_at IS NOT NULL OR detail.reminder_response IS NOT NULL OR $8::timestamptz IS NOT NULL THEN 'ended' ELSE 'failed' END,
      answered_at=COALESCE(detail.answered_at,$8::timestamptz,CASE WHEN $3::integer>0 THEN $2::timestamptz-($3*interval '1 second') END),
      ended_at=COALESCE($2::timestamptz,detail.ended_at),duration_seconds=$4,talk_seconds=$3,hangup_cause=NULLIF($5,''),
      recording_url=$6,recording_provider_id=$7,updated_at=now()
      FROM voice_reminder_call_attempts attempt WHERE detail.call_id=$1::uuid AND attempt.call_id=detail.call_id
        AND COALESCE(attempt.provider_id,attempt.call_id::text)=$7`,
    [callId,endedAt,talk,duration,match.hangupCause.slice(0,120),url,providerId,providerAnsweredAt]);
    if (updated.rowCount && url) {
      try {
        const archived = await this.archive.save(callId,url);
        await this.database.query(`UPDATE voice_reminder_call_details detail SET recording_storage_key=$2,
          recording_mime_type=$3,recording_size_bytes=$4,recording_sha256=$5,updated_at=now()
          FROM voice_reminder_call_attempts attempt WHERE detail.call_id=$1::uuid AND attempt.call_id=detail.call_id
            AND detail.recording_provider_id=$6 AND COALESCE(attempt.provider_id,attempt.call_id::text)=$6`,
        [callId,archived.storageKey,archived.mimeType,archived.sizeBytes,archived.sha256,providerId]);
      } catch { logger.warn('Voice reminder recording archive pending', { callId }); }
    }
    return this.read(callId);
  }

  async hydratePending(limit = 4): Promise<void> {
    if (this.running) return;
    this.running=true;
    try {
      const rows = (await this.database.query<{ callId: string }>(`SELECT detail.call_id AS "callId"
        FROM voice_reminder_call_details detail JOIN voice_reminder_call_attempts attempt ON attempt.call_id=detail.call_id
        WHERE detail.recording_storage_key IS NULL
          AND COALESCE(detail.ended_at,attempt.termination_confirmed_at,attempt.completed_at) IS NOT NULL
          AND detail.recording_attempts<24 AND (detail.recording_checked_at IS NULL OR
            ((detail.recording_provider_id IS NULL OR detail.talk_seconds>0 OR detail.answered_at IS NOT NULL
              OR detail.reminder_response IS NOT NULL) AND detail.recording_checked_at<now()-interval '5 minutes'))
        ORDER BY detail.recording_checked_at NULLS FIRST,detail.created_at LIMIT $1`, [Math.max(1,Math.min(20,limit))])).rows;
      for (const row of rows) {
        try { await this.hydrate(row.callId); }
        catch { logger.warn('Voice reminder recording refresh failed', { callId:row.callId }); }
      }
    } finally { this.running=false; }
  }

  start() {
    if (this.timer) return;
    this.timer=setInterval(() => { void this.hydratePending().catch(() => logger.warn('Voice reminder recording refresh unavailable')); },30_000);
    this.timer.unref();
  }

  close() { if (this.timer) clearInterval(this.timer); this.timer=null; }
}
