import { setTimeout as delay } from 'node:timers/promises';
import { hasLeadershipAccess } from '@shared/academy';
import { DEFAULT_ACADEMY_TIME_ZONE } from '@shared/scheduling';
import { pool } from '../db';
import { appConfig, isProductionEnvironment } from '../config';
import { t } from '../lib/i18n';
import { logger } from '../lib/logger';
import { getTelegramTaskIdentity } from './telegram-tasks';
import { buildTelegramWeeklyDigest, type ReminderTask } from './telegram-task-reminder-plan';
import { sendTelegramTaskReminder, type TelegramDelivery } from './telegram-task-delivery';

type Language = 'ru' | 'en';
type DigestReply = { messageId: number; section: 'own' | 'team'; language: Language };
type RefreshRequest = { botId: string; telegramUserId: string; source: unknown; language: Language };
type RefreshResult = 'replaced' | 'duplicate' | 'invalid' | 'unavailable' | 'failed';

const dayKey = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export const isTelegramDigestRefreshCommand = (text: string) => /^\/refresh_summary(?:@\w+)?$/i.test(text.trim());

export function identifyTelegramDigestReply(source: unknown, botId: string, chatId: string, timeZone: string, now: Date): DigestReply | null {
  if (!source || typeof source !== 'object') return null;
  const message = source as { message_id?: number; date?: number; text?: string; from?: { id?: number; is_bot?: boolean };
    chat?: { id?: number; type?: string }; forward_origin?: unknown; forward_date?: unknown };
  if (!Number.isSafeInteger(message.message_id) || message.message_id! <= 0 || !Number.isSafeInteger(message.date)
    || message.date! <= 0 || message.from?.is_bot !== true || String(message.from.id) !== botId
    || String(message.chat?.id) !== chatId || message.chat?.type !== 'private'
    || message.forward_origin || message.forward_date || typeof message.text !== 'string') return null;
  const sentAt = new Date(message.date! * 1000);
  if (sentAt > now || dayKey(sentAt, timeZone) !== dayKey(now, timeZone)) return null;
  for (const language of ['ru', 'en'] as const) {
    for (const section of ['own', 'team'] as const) {
      const key = section === 'team' ? 'telegramReminderWeeklyTeam' : 'telegramReminderWeeklyOwn';
      const prefix = t(key, language, { start: '', end: '' }).split('(')[0];
      if (message.text.startsWith(prefix + '(')) return { messageId: message.message_id!, section, language };
    }
  }
  return null;
}

async function deleteDigestMessage(token: string, chatId: string, messageId: number): Promise<TelegramDelivery> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }), signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json() as { ok?: boolean; result?: boolean; error_code?: number; parameters?: { retry_after?: number } };
    if (response.ok && body.ok === true && body.result === true) return { status: 'sent', code: null, retrySeconds: null };
    const code = Number(body.error_code ?? response.status);
    if (code === 429) {
      const retry = Number(body.parameters?.retry_after);
      return { status: 'deferred', code, retrySeconds: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60 };
    }
    return { status: code >= 500 ? 'uncertain' : 'failed', code, retrySeconds: null };
  } catch { return { status: 'uncertain', code: null, retrySeconds: null }; }
}

export async function refreshTelegramDigest(request: RefreshRequest, now = new Date()): Promise<RefreshResult> {
  const config = appConfig.integrations?.telegramTasks;
  const token = config?.botToken?.trim();
  if (!isProductionEnvironment || !token || !config?.webhookSecret?.trim() || token.split(':')[0] !== request.botId) return 'unavailable';
  const timeZone = process.env.ACADEMY_TIME_ZONE?.trim() || DEFAULT_ACADEMY_TIME_ZONE;
  const source = identifyTelegramDigestReply(request.source, request.botId, request.telegramUserId, timeZone, now);
  if (!source) return 'invalid';
  const identity = await getTelegramTaskIdentity(request.botId, request.telegramUserId);
  if (!identity || source.section === 'team' && !hasLeadershipAccess(identity.user)) return 'invalid';
  const appUrl = new URL('/miniapp/tasks', appConfig.server.appUrl).href;
  if (!appUrl.startsWith('https://')) return 'unavailable';
  const client = await pool.connect();
  try {
    const binding = await client.query<{ id: number }>(
      'SELECT id FROM telegram_task_bindings WHERE bot_id = $1 AND telegram_user_id = $2 AND verification_id = $3',
      [request.botId, request.telegramUserId, identity.binding.verification_id]);
    if (!binding.rows.length) return 'invalid';
    const tasks = source.section === 'team'
      ? await client.query<ReminderTask>(
        `SELECT task.id, task.title, task.due_at, task.status, employee.full_name AS assignee_name
         FROM board_tasks task JOIN users employee ON employee.id = task.assignee_id
         WHERE task.assignee_id <> $1 AND task.status <> 'accepted'
           AND employee.is_active = true AND employee.is_archived = false
         ORDER BY task.due_at NULLS LAST, employee.full_name, task.id`, [identity.user.id])
      : await client.query<ReminderTask>(
        `SELECT id, title, due_at, status FROM board_tasks WHERE assignee_id = $1 AND status <> 'accepted'
         ORDER BY due_at NULLS LAST, id`, [identity.user.id]);
    const messages = buildTelegramWeeklyDigest(tasks.rows, now, timeZone, source.section, source.language);
    // A replacement is a manual delivery of the daily digest. Keep its claim
    // separate from scheduled deliveries, including across webhook retries.
    const claim = await client.query<{ id: number }>(
      `INSERT INTO telegram_task_reminders (binding_id, kind, event_key, status)
       VALUES ($1, 'daily', $2, 'attempted') ON CONFLICT (binding_id, kind, event_key) DO UPDATE
       SET status = 'attempted', updated_at = $3
       WHERE telegram_task_reminders.status = 'deferred' AND telegram_task_reminders.next_attempt_at <= $3 RETURNING id`,
      [binding.rows[0].id, `${dayKey(now, timeZone)}:replace:${source.messageId}`, now]);
    if (!claim.rows.length) return 'duplicate';
    const record = (delivery: TelegramDelivery) => client.query(
      'UPDATE telegram_task_reminders SET status = $2, error_code = $3, next_attempt_at = $4, updated_at = $5 WHERE id = $1',
      [claim.rows[0].id, delivery.status, delivery.code,
        delivery.retrySeconds ? new Date(Date.now() + delivery.retrySeconds * 1000) : null, new Date()]);
    const deletion = await deleteDigestMessage(token, request.telegramUserId, source.messageId);
    if (deletion.status !== 'sent') { await record(deletion); return 'failed'; }
    for (const message of messages) {
      const delivery = await sendTelegramTaskReminder(token, request.telegramUserId, message.text, appUrl, message.buttons);
      if (delivery.status !== 'sent') {
        // The source is already deleted. Do not restart the whole replacement
        // after a partial/ambiguous send, even for a new webhook update.
        await record({ ...delivery, status: 'uncertain', retrySeconds: null });
        return 'failed';
      }
      await delay(100);
    }
    await record({ status: 'sent', code: null, retrySeconds: null });
    return 'replaced';
  } finally { client.release(); }
}

async function replyRefreshFailure(request: RefreshRequest, invalid: boolean) {
  const config = appConfig.integrations?.telegramTasks;
  const token = config?.botToken?.trim();
  if (!isProductionEnvironment || !token || !config?.webhookSecret?.trim() || token.split(':')[0] !== request.botId) return;
  await sendTelegramTaskReminder(token, request.telegramUserId,
    t(invalid ? 'telegramDigestReplyRequired' : 'telegramDigestRefreshFailed', request.language),
    new URL('/miniapp/tasks', appConfig.server.appUrl).href);
}

export function enqueueTelegramDigestRefresh(request: RefreshRequest) {
  void refreshTelegramDigest(request).then(async (result) => {
    if (result !== 'replaced' && result !== 'duplicate') await replyRefreshFailure(request, result === 'invalid');
  }).catch(async () => {
    logger.warn('Telegram digest replacement failed');
    await replyRefreshFailure(request, false).catch(() => logger.warn('Telegram digest replacement response failed'));
  });
}
