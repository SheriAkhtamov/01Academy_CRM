import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const createUserPhonesTable = (userIdColumn: AnyPgColumn) => pgTable("user_phones", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => userIdColumn, { onDelete: "cascade" }),
  phone: varchar("phone", { length: 50 }).notNull(),
  normalizedPhone: varchar("normalized_phone", { length: 50 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("user_phones_user_idx").on(table.userId),
  userPhoneUnique: uniqueIndex("user_phones_user_phone_unique").on(table.userId, table.normalizedPhone),
  userSortOrderUnique: uniqueIndex("user_phones_user_sort_order_unique").on(table.userId, table.sortOrder),
}));
