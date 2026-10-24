import { pool } from '../db';
import { setTimeout as delay } from 'node:timers/promises';
import { appConfig, isProductionEnvironment } from '../config';
import { logger } from '../lib/logger';
import { t } from '../lib/i18n';
import { onlinePbxClient } from './onlinepbx';
import { planOnlinePbxLicenseReminders } from './onlinepbx-license-reminder-plan';
import { getTelegramTaskIdentity } from './telegram-tasks';
import { sendTelegramTaskReminder } from './telegram-task-delivery';
import { ensureOnlinePbxLicenseTask } from '../storage/onlinepbx-license-tasks';
import { publishRealtimeEvent } from '../realtime/realtime-hub';

export async function processOnlinePbxLicenseReminders(timeZone: string, now = new Date()): Promise<number> {
  const config = appConfig.integrations;
  const token = config?.telegramTasks?.botToken?.trim();
  const userIds = config?.onlinePbx?.licenseReminderUserIds;
  if (!isProductionEnvironment || !userIds?.length || !onlinePbxClient.isConfigured()) return 0;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 9) return 0;
  const domain = onlinePbxClient.getDomain();
  const botId = token?.split(':')[0] ?? domain;
  // Share the task reminder lock and Telegram cooldowns with the existing sender.
  const lockKey = `telegram-task-reminders:${botId}`;
  const client = await pool.connect();
  let locked = false;
  let sent = 0;
  const started = Date.now();
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey])).rows[0]?.locked === true;
    if (!locked) return 0;
    const planned = planOnlinePbxLicenseReminders(await onlinePbxClient.listLicenses(), domain, now, timeZone);
    const tasks = new Map<string, number>();
    for (const userId of userIds) {
      for (const reminder of planned) {
        const result = await ensureOnlinePbxLicenseTask({
          domain, endStamp: reminder.endStamp, userId,
          title: t('onlinePbxLicenseTaskTitle', { domain }).slice(0, 255),
          description: `${reminder.text}\n\nhttps://panel.onlinepbx.ru/`,
        });
        if (result.created && result.task) {
          publishRealtimeEvent({ type: 'BOARD_TASK_CREATED', data: { id: result.task.id, boardId: result.task.boardId } });
          logger.info('OnlinePBX renewal task created', { taskId: result.task.id, assigneeId: userId });
        }
        if (result.task?.assigneeId === userId && ['backlog', 'todo', 'in_progress'].includes(result.task.status)) {
          tasks.set(`${userId}:${reminder.endStamp}`, result.task.id);
        }
      }
    }
    if (!token || !config?.telegramTasks?.webhookSecret?.trim() || !tasks.size) return 0;
    const appUrl = new URL('/miniapp/tasks', appConfig.server.appUrl).href;
    if (!appUrl.startsWith('https://')) return 0;
    const cooldown = await client.query(
      `SELECT 1 FROM telegram_task_reminders reminder
       JOIN telegram_task_bindings binding ON binding.id = reminder.binding_id
       WHERE binding.bot_id = $1 AND reminder.error_code = 429 AND reminder.next_attempt_at > $2
       UNION ALL SELECT 1 FROM telegram_task_events WHERE status = 'deferred' AND next_attempt_at > $2 LIMIT 1`, [botId, now]);
    if (cooldown.rows.length) return 0;
    const bindings = await client.query<{ id: number; user_id: number; telegram_user_id: string; verification_id: string }>(
      `SELECT binding.id, binding.user_id, binding.telegram_user_id, binding.verification_id
       FROM telegram_task_bindings binding JOIN users employee ON employee.id = binding.user_id
       WHERE binding.bot_id = $1 AND binding.user_id = ANY($2::integer[])
         AND employee.is_active = true AND employee.is_archived = false ORDER BY binding.id`, [botId, userIds]);
    if (!bindings.rows.length) return 0;
    for (const binding of bindings.rows) {
      for (const reminder of planned) {
        if (Date.now() - started >= 40_000) return sent;
        const taskId = tasks.get(`${binding.user_id}:${reminder.endStamp}`);
        if (!taskId) continue;
        const identity = await getTelegramTaskIdentity(botId, binding.telegram_user_id);
        if (!identity || identity.user.id !== binding.user_id || identity.binding.verification_id !== binding.verification_id) break;
        const current = await client.query(
          `SELECT 1 FROM board_tasks WHERE id = $1 AND assignee_id = $2 AND status IN ('backlog', 'todo', 'in_progress')`, [taskId, binding.user_id]);
        if (!current.rows.length) continue;
        // Persist before sending: restarts and ambiguous Telegram timeouts must
        // never produce duplicate payment requests. Only explicit 429s retry.
        const claim = await client.query<{ id: number }>(
          `INSERT INTO telegram_task_reminders (binding_id, kind, event_key, status)
           VALUES ($1, 'onlinepbx_license', $2, 'attempted')
           ON CONFLICT (binding_id, kind, event_key) DO UPDATE
           SET status = 'attempted', updated_at = $3
           WHERE telegram_task_reminders.status = 'deferred' AND telegram_task_reminders.next_attempt_at <= $3
           RETURNING id`, [binding.id, reminder.eventKey, now]);
        if (!claim.rows.length) continue;
        const result = await sendTelegramTaskReminder(token, binding.telegram_user_id, reminder.text, appUrl,
          [{ text: t('telegramTaskOpen'), destination: { taskId, view: 'mine' } }]);
        const nextAttempt = result.retrySeconds === null ? null : new Date(Date.now() + result.retrySeconds * 1000);
        await client.query(
          `UPDATE telegram_task_reminders SET status = $2, error_code = $3, next_attempt_at = $4,
           updated_at = $5 WHERE id = $1`, [claim.rows[0].id, result.status, result.code, nextAttempt, new Date()]);
        if (result.status === 'sent') sent++;
        else logger.warn('OnlinePBX license reminder not confirmed', { reminderId: claim.rows[0].id, status: result.status, errorCode: result.code });
        if (result.code === 429 || result.code === 401) return sent;
        if (result.status !== 'sent') break;
        await delay(100);
      }
    }
    return sent;
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      client.release();
    } catch {
      client.release(true);
    }
  }
}
