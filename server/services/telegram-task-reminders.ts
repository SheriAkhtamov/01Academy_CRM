import { setTimeout as delay } from 'node:timers/promises';
import { pool } from '../db';
import { appConfig, isProductionEnvironment } from '../config';
import { logger } from '../lib/logger';
import { t } from '../lib/i18n';
import { getTelegramTaskIdentity } from './telegram-tasks';
import { planTelegramTaskReminders, type ReminderTask } from './telegram-task-reminder-plan';

type Delivery = { status: 'sent' | 'deferred' | 'failed' | 'uncertain'; code: number | null; retrySeconds: number | null };

export async function sendTelegramTaskReminder(botToken: string, chatId: string, text: string, appUrl: string): Promise<Delivery> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: t('telegramReminderOpen'), web_app: { url: appUrl } }]] } }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { ok?: boolean; error_code?: number; parameters?: { retry_after?: number } };
    if (response.ok && result.ok === true) return { status: 'sent', code: null, retrySeconds: null };
    const code = Number(result.error_code ?? response.status);
    if (code === 429) {
      const retry = Number(result.parameters?.retry_after);
      return { status: 'deferred', code, retrySeconds: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60 };
    }
    return { status: code >= 500 ? 'uncertain' : 'failed', code, retrySeconds: null };
  } catch {
    // Telegram sendMessage has no idempotency key. Do not blindly resend after
    // a timeout: Telegram may have accepted the first message. Tomorrow's
    // digest still covers unfinished work. Never log raw URLs/errors/tokens.
    return { status: 'uncertain', code: null, retrySeconds: null };
  }
}

export async function processTelegramTaskReminders(timeZone: string, now = new Date()): Promise<number> {
  const config = appConfig.integrations?.telegramTasks;
  const token = config?.botToken?.trim();
  // A local dev/test process must never notify real employees using copied config.
  if (!isProductionEnvironment || !token || !config?.webhookSecret?.trim()) return 0;
  const botId = token.split(':')[0];
  const appUrl = new URL('/miniapp/tasks', appConfig.server.appUrl).href;
  if (!appUrl.startsWith('https://')) return 0;
  const client = await pool.connect();
  const lockKey = `telegram-task-reminders:${botId}`;
  let locked = false;
  let sent = 0;
  const started = Date.now();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return 0;
    const cooldown = await client.query(
      `SELECT 1 FROM telegram_task_reminders reminder
       JOIN telegram_task_bindings binding ON binding.id = reminder.binding_id
       WHERE binding.bot_id = $1 AND reminder.error_code = 429 AND reminder.next_attempt_at > $2 LIMIT 1`, [botId, now]);
    if (cooldown.rows.length) return 0;
    const bindings = await client.query<{ id: number; user_id: number; telegram_user_id: string; verification_id: string }>(
      `SELECT binding.id, binding.user_id, binding.telegram_user_id, binding.verification_id
       FROM telegram_task_bindings binding JOIN users employee ON employee.id = binding.user_id
       WHERE binding.bot_id = $1 AND employee.is_active = true AND employee.is_archived = false
         AND NOT EXISTS (
           SELECT 1 FROM telegram_task_reminders reminder WHERE reminder.binding_id = binding.id
           AND reminder.error_code IN (400, 403) AND reminder.updated_at > $2::timestamp - interval '24 hours'
         ) ORDER BY binding.id`, [botId, now]);
    for (const binding of bindings.rows) {
      if (Date.now() - started > 40_000) break;
      // The same live identity check as Mini App access: every saved employee
      // phone, archive/deletion and ambiguous-phone conflicts are respected.
      const identity = await getTelegramTaskIdentity(botId, binding.telegram_user_id);
      if (!identity || identity.user.id !== binding.user_id || identity.binding.verification_id !== binding.verification_id) continue;
      const tasks = await client.query<ReminderTask>(
        `SELECT id, title, due_at FROM board_tasks
         WHERE assignee_id = $1 AND status IN ('backlog', 'todo', 'in_progress')
         ORDER BY due_at NULLS LAST, id`, [binding.user_id]);
      for (const reminder of planTelegramTaskReminders(tasks.rows, now, timeZone)) {
        // Persist the claim BEFORE calling Telegram. It survives restarts, and
        // the unique key also protects against concurrent workers/repeated ticks.
        const claim = await client.query<{ id: number }>(
          `INSERT INTO telegram_task_reminders (binding_id, kind, event_key, status)
           VALUES ($1, $2, $3, 'attempted')
           ON CONFLICT (binding_id, kind, event_key) DO UPDATE
           SET status = 'attempted', updated_at = $4
           WHERE telegram_task_reminders.status = 'deferred' AND telegram_task_reminders.next_attempt_at <= $4
           RETURNING id`, [binding.id, reminder.kind, reminder.eventKey, now]);
        if (!claim.rows.length) continue;
        const delivery = await sendTelegramTaskReminder(token, binding.telegram_user_id, reminder.text, appUrl);
        const nextAttempt = delivery.retrySeconds === null ? null : new Date(Date.now() + delivery.retrySeconds * 1000);
        await client.query(
          `UPDATE telegram_task_reminders SET status = $2, error_code = $3, next_attempt_at = $4,
           updated_at = $5 WHERE id = $1`, [claim.rows[0].id, delivery.status, delivery.code, nextAttempt, new Date()]);
        if (delivery.status === 'sent') sent++;
        else logger.warn('Telegram task reminder not confirmed', {
          reminderId: claim.rows[0].id, status: delivery.status, errorCode: delivery.code,
        });
        if (delivery.code === 429 || delivery.code === 401) return sent;
        // At most one reminder per recipient per tick; stay below Telegram's
        // free broadcast limit without paid broadcasts or blocking the API.
        await delay(100);
        break;
      }
    }
    return sent;
  } finally {
    // If unlock fails, destroy this pooled connection rather than leaking a
    // session-level advisory lock onto another application request.
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      client.release();
    } catch {
      client.release(true);
    }
  }
}
