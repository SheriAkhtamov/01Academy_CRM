import { setTimeout as delay } from 'node:timers/promises';
import { pool } from '../db';
import { appConfig, isProductionEnvironment } from '../config';
import { logger } from '../lib/logger';
import { hasLeadershipAccess } from '@shared/academy';
import { getTelegramTaskIdentity } from './telegram-tasks';
import { planTelegramTaskReminders, planTelegramWeeklyDigest, planTelegramOverdueReminders, type ReminderTask } from './telegram-task-reminder-plan';

import { sendTelegramTaskReminder } from './telegram-task-delivery';
export { sendTelegramTaskReminder } from './telegram-task-delivery';

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
    const eventCooldown = await client.query(
      "SELECT 1 FROM telegram_task_events WHERE status = 'deferred' AND next_attempt_at > $1 LIMIT 1", [now]);
    if (eventCooldown.rows.length) return 0;
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
        `SELECT id, title, due_at, status FROM board_tasks
         WHERE assignee_id = $1 AND status <> 'accepted'
         ORDER BY due_at NULLS LAST, id`, [binding.user_id]);
      const daily = planTelegramWeeklyDigest(tasks.rows, now, timeZone);
      if (daily.length && hasLeadershipAccess(identity.user)) {
        const team = await client.query<ReminderTask>(
          `SELECT task.id, task.title, task.due_at, task.status, task.assignee_id, employee.full_name AS assignee_name
           FROM board_tasks task
           JOIN users employee ON employee.id = task.assignee_id
           WHERE task.assignee_id <> $1 AND task.status <> 'accepted'
             AND employee.is_active = true AND employee.is_archived = false
           ORDER BY task.due_at NULLS LAST, employee.full_name, task.id`, [binding.user_id]);
        daily.push(...planTelegramWeeklyDigest(team.rows, now, timeZone, 'team'));
      }
      const dueSoon = planTelegramTaskReminders(
        tasks.rows.filter((task) => ['backlog', 'todo', 'in_progress'].includes(task.status ?? '')),
        now, timeZone,
      );
      const overdueTasks = await client.query<ReminderTask>(
        `SELECT id, title, due_at, status, assignee_id, creator_id FROM board_tasks
         WHERE (assignee_id = $1 OR creator_id = $1) AND status IN ('backlog', 'todo', 'in_progress') AND due_at <= $2
         ORDER BY due_at, id`, [binding.user_id, now]);
      const overdue = planTelegramOverdueReminders(overdueTasks.rows, now, timeZone, binding.user_id);
      for (const reminder of [...daily, ...dueSoon, ...overdue]) {
        if (Date.now() - started > 40_000) break;
        // Persist the claim BEFORE calling Telegram. It survives restarts, and
        // the unique key also protects against concurrent workers/repeated ticks.
        const claim = await client.query<{ id: number }>(
          `INSERT INTO telegram_task_reminders (binding_id, kind, event_key, status)
           VALUES ($1, $2, $3, 'attempted')
           ON CONFLICT (binding_id, kind, event_key) DO UPDATE
           SET status = 'attempted', updated_at = $4
           WHERE telegram_task_reminders.status = 'deferred' AND telegram_task_reminders.next_attempt_at <= $4
           RETURNING id`, [binding.id, reminder.kind, reminder.eventKey, now]);
        if (!claim.rows.length) {
          if (reminder.kind === 'daily') {
            const prior = await client.query<{ status: string }>(
              `SELECT status FROM telegram_task_reminders
               WHERE binding_id = $1 AND kind = $2 AND event_key = $3`,
              [binding.id, reminder.kind, reminder.eventKey]);
            // Later chunks must never arrive before an earlier chunk succeeds.
            if (prior.rows[0]?.status !== 'sent') break;
          }
          continue;
        }
        const delivery = await sendTelegramTaskReminder(token, binding.telegram_user_id, reminder.text, appUrl, reminder.buttons);
        const nextAttempt = delivery.retrySeconds === null ? null : new Date(Date.now() + delivery.retrySeconds * 1000);
        await client.query(
          `UPDATE telegram_task_reminders SET status = $2, error_code = $3, next_attempt_at = $4,
           updated_at = $5 WHERE id = $1`, [claim.rows[0].id, delivery.status, delivery.code, nextAttempt, new Date()]);
        if (delivery.status === 'sent') sent++;
        else logger.warn('Telegram task reminder not confirmed', {
          reminderId: claim.rows[0].id, status: delivery.status, errorCode: delivery.code,
        });
        if (delivery.code === 429 || delivery.code === 401) return sent;
        if (delivery.status !== 'sent') break;
        // Pace consecutive chunks below Telegram's free broadcast limit.
        await delay(100);
        if (reminder.kind !== 'daily') break;
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
