import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { check, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const createTelegramTaskRemindersTable = (bindingIdColumn: AnyPgColumn) => pgTable('telegram_task_reminders', {
  id: serial('id').primaryKey(),
  bindingId: integer('binding_id').notNull().references(() => bindingIdColumn, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 20 }).notNull(),
  eventKey: varchar('event_key', { length: 120 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  nextAttemptAt: timestamp('next_attempt_at'),
  errorCode: integer('error_code'),
  createdAt: timestamp('created_at').notNull().default(sql`(now() AT TIME ZONE 'UTC')`),
  updatedAt: timestamp('updated_at').notNull().default(sql`(now() AT TIME ZONE 'UTC')`),
}, (table) => ({
  eventUnique: uniqueIndex('telegram_task_reminders_event_unique').on(table.bindingId, table.kind, table.eventKey),
  cooldownIdx: index('telegram_task_reminders_cooldown_idx').on(table.errorCode, table.nextAttemptAt),
  kindCheck: check('telegram_task_reminders_kind_check', sql`${table.kind} IN ('daily', 'due_soon')`),
  statusCheck: check('telegram_task_reminders_status_check', sql`${table.status} IN ('attempted', 'sent', 'deferred', 'failed', 'uncertain')`),
}));
