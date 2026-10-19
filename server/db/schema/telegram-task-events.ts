import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { TaskNotice } from '../../domain/board-task-notices';

export const createTelegramTaskEventsTable = (userIdColumn: AnyPgColumn) => pgTable('telegram_task_events', {
  id: serial('id').primaryKey(),
  recipientId: integer('recipient_id').notNull().references(() => userIdColumn, { onDelete: 'cascade' }),
  eventKey: varchar('event_key', { length: 120 }).notNull(),
  payload: jsonb('payload').$type<TaskNotice>().notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  nextAttemptAt: timestamp('next_attempt_at'),
  createdAt: timestamp('created_at').notNull().default(sql`(now() AT TIME ZONE 'UTC')`),
}, (table) => ({
  eventUnique: uniqueIndex('telegram_task_events_event_unique').on(table.recipientId, table.eventKey),
  pendingIdx: index('telegram_task_events_pending_idx').on(table.status, table.nextAttemptAt, table.id),
  statusCheck: check('telegram_task_events_status_check', sql`${table.status} IN ('pending', 'attempted', 'sent', 'deferred', 'failed', 'uncertain', 'skipped')`),
}));
