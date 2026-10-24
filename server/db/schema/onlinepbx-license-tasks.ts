import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { bigint, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const createOnlinePbxLicenseTasksTable = (userId: AnyPgColumn, taskId: AnyPgColumn) => pgTable('onlinepbx_license_tasks', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull(),
  endStamp: bigint('end_stamp', { mode: 'number' }).notNull(),
  userId: integer('user_id').notNull().references(() => userId, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => taskId, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().default(sql`(now() AT TIME ZONE 'UTC')`),
}, (table) => ({
  periodUnique: uniqueIndex('onlinepbx_license_tasks_period_unique').on(table.domain, table.endStamp, table.userId),
}));

export const createOnlinePbxLicenseIssuesTable = (userId: AnyPgColumn, taskId: AnyPgColumn) => pgTable('onlinepbx_license_issues', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull(),
  extension: varchar('extension', { length: 20 }).notNull(),
  userId: integer('user_id').notNull().references(() => userId, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => taskId, { onDelete: 'set null' }),
  openedAt: timestamp('opened_at').notNull().default(sql`(now() AT TIME ZONE 'UTC')`),
  resolvedAt: timestamp('resolved_at'),
}, (table) => ({
  extensionUnique: uniqueIndex('onlinepbx_license_issues_extension_unique').on(table.domain, table.extension, table.userId),
}));
