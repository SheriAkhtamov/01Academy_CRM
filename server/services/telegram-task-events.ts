import { setTimeout as delay } from 'node:timers/promises';
import { pool } from '../db';
import { appConfig, isProductionEnvironment } from '../config';
import { getTelegramTaskIdentity } from './telegram-tasks';
import { sendTelegramTaskReminder } from './telegram-task-delivery';
import { t } from '../lib/i18n';
import { logger } from '../lib/logger';
import type { TaskNotice } from '../domain/board-task-notices';

const noticeKeys = {
  created: 'telegramTaskCreated', assigned: 'telegramTaskAssigned', unassigned: 'telegramTaskUnassigned',
  updated: 'telegramTaskUpdated', started: 'telegramTaskProgressStarted', done: 'telegramTaskProgressDone',
  accepted: 'telegramTaskAccepted', reopened: 'telegramTaskReopened', status: 'telegramTaskStatusChanged',
  deleted: 'telegramTaskDeleted', comment: 'telegramTaskComment', attachment: 'telegramTaskAttachment',
} as const;
const fieldKeys = { title: 'telegramTaskFieldTitle', description: 'telegramTaskFieldDescription',
  priority: 'telegramTaskFieldPriority', dueAt: 'telegramTaskFieldDeadline', assigneeId: 'telegramTaskFieldAssignee' } as const;
const clean = (value: string, limit: number) => Array.from(value.replace(/[\r\n\t]/g, ' ').trim()).slice(0, limit).join('');

export function telegramTaskNoticeText(notice: TaskNotice, actorName: string): string {
  const text = t(noticeKeys[notice.kind], { title: clean(notice.title, 255), assignee: clean(actorName, 100) });
  const fields = (notice.fields ?? []).flatMap((field) => field in fieldKeys ? [t(fieldKeys[field as keyof typeof fieldKeys])] : []);
  return fields.length && ['updated', 'assigned'].includes(notice.kind)
    ? `${text}\n${t('telegramTaskChangedFields', { fields: fields.join(', ') })}` : text;
}

export async function processTelegramTaskEvents(): Promise<number> {
  const config = appConfig.integrations?.telegramTasks;
  const token = config?.botToken?.trim();
  if (!isProductionEnvironment || !token || !config?.webhookSecret?.trim()) return 0;
  const appUrl = new URL('/miniapp/tasks', appConfig.server.appUrl).href;
  if (!appUrl.startsWith('https://')) return 0;
  const botId = token.split(':')[0];
  const client = await pool.connect();
  const lockKey = `telegram-task-events:${botId}`;
  let locked = false;
  let sent = 0;
  const started = Date.now();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return 0;
    const cooldown = await client.query(
      `SELECT 1 FROM telegram_task_events WHERE status = 'deferred' AND next_attempt_at > $1
       UNION ALL SELECT 1 FROM telegram_task_reminders reminder
       JOIN telegram_task_bindings binding ON binding.id = reminder.binding_id
       WHERE binding.bot_id = $2 AND reminder.error_code = 429 AND reminder.next_attempt_at > $1 LIMIT 1`, [new Date(), botId]);
    if (cooldown.rows.length) return 0;
    while (Date.now() - started < 40_000) {
      // Keep validation failures retryable. Claim only when ready to send;
      // interrupted/ambiguous sendMessage attempts must never be replayed.
      const candidate = await client.query<{ id: number; recipient_id: number; payload: TaskNotice }>(
        `SELECT id, recipient_id, payload FROM telegram_task_events WHERE status = 'pending'
           OR (status = 'deferred' AND next_attempt_at <= $1)
         ORDER BY id LIMIT 1`, [new Date()]);
      const event = candidate.rows[0];
      if (!event) break;
      const binding = await client.query<{ telegram_user_id: string }>(
        'SELECT telegram_user_id FROM telegram_task_bindings WHERE bot_id = $1 AND user_id = $2', [botId, event.recipient_id]);
      const chatId = binding.rows[0]?.telegram_user_id;
      const identity = chatId ? await getTelegramTaskIdentity(botId, chatId) : null;
      const notice = event.payload;
      let allowed = identity?.user.id === event.recipient_id;
      if (allowed && notice.kind !== 'deleted' && notice.kind !== 'unassigned') {
        const current = await client.query(
          'SELECT 1 FROM board_tasks WHERE id = $1 AND (creator_id = $2 OR assignee_id = $2)', [notice.taskId, event.recipient_id]);
        allowed = current.rows.length > 0;
      }
      if (allowed && notice.destination.commentId) {
        const comment = await client.query('SELECT 1 FROM board_task_comments WHERE id = $1 AND task_id = $2', [notice.destination.commentId, notice.taskId]);
        allowed = comment.rows.length > 0;
      }
      if (allowed && notice.destination.attachmentId) {
        const attachment = await client.query('SELECT 1 FROM board_task_attachments WHERE id = $1 AND task_id = $2', [notice.destination.attachmentId, notice.taskId]);
        allowed = attachment.rows.length > 0;
      }
      if (!allowed) {
        await client.query("UPDATE telegram_task_events SET status = 'skipped' WHERE id = $1", [event.id]);
        continue;
      }
      const actor = notice.actorId ? await client.query<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [notice.actorId]) : null;
      const buttonKey = notice.kind === 'comment' ? 'telegramTaskOpenComments'
        : notice.kind === 'attachment' ? 'telegramTaskOpenAttachments'
        : notice.destination.taskId ? 'telegramTaskOpen' : 'telegramReminderOpen';
      const text = telegramTaskNoticeText(notice, actor?.rows[0]?.full_name ?? '');
      const claim = await client.query(
        `UPDATE telegram_task_events SET status = 'attempted' WHERE id = $1
         AND (status = 'pending' OR (status = 'deferred' AND next_attempt_at <= $2)) RETURNING id`, [event.id, new Date()]);
      if (!claim.rows.length) continue;
      const delivery = await sendTelegramTaskReminder(token, chatId!, text, appUrl,
        [{ text: t(buttonKey), destination: notice.destination }]);
      await client.query('UPDATE telegram_task_events SET status = $2, next_attempt_at = $3 WHERE id = $1',
        [event.id, delivery.status, delivery.retrySeconds ? new Date(Date.now() + delivery.retrySeconds * 1000) : null]);
      if (delivery.status === 'sent') sent++;
      else logger.warn('Telegram task event delivery not confirmed', { eventId: event.id, status: delivery.status, errorCode: delivery.code });
      if (delivery.code === 429 || delivery.code === 401) break;
      await delay(100);
    }
    return sent;
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      client.release();
    } catch { client.release(true); }
  }
}
