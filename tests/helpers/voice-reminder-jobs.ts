import type { Pool } from 'pg';
import { VOICE_REMINDER_STATUSES, type VoiceReminderStatus } from '../../shared/contracts/voice-reminders';

/** Private queue assertions only; the application has no history read model. */
export const readVoiceReminderJobs = async (database: Pick<Pool, 'query'>) => {
  const rows = (await database.query<{
    id: number; status: VoiceReminderStatus; phone: string; attempts: number;
    scheduledAt: Date; dueAt: Date; lastCallAt: Date | null; completedAt: Date | null;
  }>(`SELECT id::int AS id,status,COALESCE(phone,'') AS phone,attempts,scheduled_at AS "scheduledAt",
    GREATEST(due_at,COALESCE(not_before_at,due_at)) AS "dueAt",last_call_at AS "lastCallAt",completed_at AS "completedAt"
    FROM voice_reminder_jobs ORDER BY updated_at DESC,id DESC`)).rows;
  const summary = Object.fromEntries(VOICE_REMINDER_STATUSES.map(status => [status, 0])) as Record<VoiceReminderStatus, number>;
  for (const row of rows) summary[row.status] += 1;
  const results = rows.map(row => ({ ...row, scheduledAt: row.scheduledAt.toISOString(), dueAt: row.dueAt.toISOString(),
    lastCallAt: row.lastCallAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null }));
  return { summary, results };
};
