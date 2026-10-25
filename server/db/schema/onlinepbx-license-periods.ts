import { bigint, boolean, integer, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

export const onlinePbxLicensePeriods = pgTable('onlinepbx_license_periods', {
  domain: varchar('domain', { length: 255 }).notNull(),
  serviceType: varchar('service_type', { length: 64 }).notNull(),
  startStamp: bigint('start_stamp', { mode: 'number' }).notNull(),
  endStamp: bigint('end_stamp', { mode: 'number' }).notNull(),
  serviceCount: integer('service_count').notNull(),
  isCurrent: boolean('is_current').notNull(),
  firstSeenAt: timestamp('first_seen_at').notNull(),
  lastSeenAt: timestamp('last_seen_at').notNull(),
}, (table) => ({
  periodKey: primaryKey({ columns: [table.domain, table.serviceType, table.startStamp, table.endStamp] }),
}));
