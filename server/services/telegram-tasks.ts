import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { storage } from '../storage';
import { normalizeEmployeePhone, type TaskToken } from './telegram-tasks-crypto';
import { hasLeadershipAccess } from '@shared/academy';
import type { User } from '../db/schema';

export const telegramTaskAccess = {
  async getAssignableUsers() {
    return (await storage.getUsers()).filter((user) => user.isActive && !user.isArchived)
      .map(({ id, fullName, position, module }) => ({ id, fullName, position, module }));
  },
  async canDownload(user: User, attachmentId: number) {
    const attachment = await storage.board.getAttachment(attachmentId);
    const task = attachment && await storage.board.getTask(attachment.taskId);
    return Boolean(task && (task.creatorId === user.id || task.assigneeId === user.id || hasLeadershipAccess(user)));
  },
};

export interface TelegramTaskBinding {
  bot_id: string;
  telegram_user_id: string;
  user_id: number;
  verified_phone: string;
  verification_id: string;
}

export class TelegramBindingDenied extends Error {}

type EmployeePhoneRow = { id: number; phone: string };

const matchingEmployeeIds = (rows: readonly EmployeePhoneRow[], phone: string): number[] => [
  ...new Set(rows
    .filter((employee) => normalizeEmployeePhone(employee.phone) === phone)
    .map((employee) => employee.id)),
];

const hasVerifiedPhone = (phoneNumbers: readonly string[], verifiedPhone: string) =>
  phoneNumbers.some((phone) => normalizeEmployeePhone(phone) === verifiedPhone);

export async function getTelegramTaskIdentity(botId: string, telegramUserId: string, token?: TaskToken) {
  const { rows } = await pool.query<TelegramTaskBinding>(
    'SELECT * FROM telegram_task_bindings WHERE bot_id = $1 AND telegram_user_id = $2', [botId, telegramUserId],
  );
  const binding = rows[0];
  if (!binding || (token && (token.userId !== binding.user_id || token.verificationId !== binding.verification_id))) return null;
  const user = await storage.getUser(binding.user_id);
  if (!user?.isActive || user.isArchived || !hasVerifiedPhone(user.phoneNumbers, binding.verified_phone)) return null;
  const employees = await pool.query<EmployeePhoneRow>(
    `SELECT employee.id, phone.phone
     FROM users employee
     JOIN user_phones phone ON phone.user_id = employee.id
     WHERE employee.is_active = true AND employee.is_archived = false`,
  );
  const matches = matchingEmployeeIds(employees.rows, binding.verified_phone);
  if (matches.length !== 1 || matches[0] !== user.id) return null;
  return { user, binding };
}

export async function bindTelegramTaskEmployee(botId: string, telegramUserId: string, rawPhone: unknown) {
  const phone = normalizeEmployeePhone(rawPhone);
  if (!phone) throw new TelegramBindingDenied();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`telegram-task-registration:${botId}`]);
    const employees = await client.query<EmployeePhoneRow>(
      `SELECT employee.id, phone.phone
       FROM users employee
       JOIN user_phones phone ON phone.user_id = employee.id
       WHERE employee.is_active = true AND employee.is_archived = false
       ORDER BY employee.id, phone.sort_order
       FOR UPDATE OF employee, phone`,
    );
    const matches = matchingEmployeeIds(employees.rows, phone);
    if (matches.length !== 1) throw new TelegramBindingDenied();
    const userId = matches[0];
    const existing = await client.query<TelegramTaskBinding>(
      'SELECT * FROM telegram_task_bindings WHERE bot_id = $1 AND (telegram_user_id = $2 OR user_id = $3) FOR UPDATE',
      [botId, telegramUserId, userId],
    );
    if (existing.rows.some((row) => row.user_id !== userId || row.telegram_user_id !== telegramUserId)) {
      throw new TelegramBindingDenied();
    }
    const version = existing.rows[0]?.verified_phone === phone ? existing.rows[0].verification_id : randomUUID();
    await client.query(
      `INSERT INTO telegram_task_bindings (bot_id, telegram_user_id, user_id, verified_phone, verification_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (bot_id, telegram_user_id) DO UPDATE
       SET verified_phone = EXCLUDED.verified_phone, verification_id = EXCLUDED.verification_id, updated_at = now()`,
      [botId, telegramUserId, userId, phone, version],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getTelegramTaskIdentity(botId, telegramUserId);
}
