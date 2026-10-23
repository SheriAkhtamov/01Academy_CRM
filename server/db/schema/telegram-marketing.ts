import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, integer, jsonb, primaryKey, check } from 'drizzle-orm/pg-core';

export const telegramMarketingSessions = pgTable('telegram_marketing_sessions', {
  botId: text('bot_id').notNull(),
  // Private chat ID or negative group/supergroup ID; kept for database compatibility.
  telegramUserId: text('telegram_user_id').notNull(),
  accessVersion: text('access_version'),
  authenticatedAt: timestamp('authenticated_at'),
  failures: integer('failures').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
  state: jsonb('state').notNull().default({}),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.botId, table.telegramUserId] }),
  ids: check('telegram_marketing_session_ids', sql`${table.botId} ~ '^[0-9]+$' AND ${table.telegramUserId} ~ '^-?[1-9][0-9]*$'`),
  failures: check('telegram_marketing_failures', sql`${table.failures} >= 0`),
}));
