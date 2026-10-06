import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const academySchools = pgTable("academy_schools", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull(),
  address: text("address").notNull(),
  rooms: jsonb("rooms").$type<string[]>().notNull().default([]),
  timezone: varchar("timezone", { length: 80 }).notNull().default("Asia/Tashkent"),
  isActive: boolean("is_active").notNull().default(true),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedPreviousIsActive: boolean("archived_previous_is_active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  codeUnique: uniqueIndex("academy_schools_code_unique").on(table.code),
  archivedInactive: check("academy_schools_archived_inactive", sql`NOT ${table.isArchived} OR NOT ${table.isActive}`),
}));

/**
 * Bookable physical resources. The legacy academy_schools.rooms JSON is kept
 * solely to allow existing installations to migrate without losing data.
 */
export const academyRooms = pgTable("academy_rooms", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").references(() => academySchools.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  capacity: integer("capacity").notNull().default(12),
  isActive: boolean("is_active").notNull().default(true),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedBySchool: boolean("archived_by_school").notNull().default(false),
  archivedPreviousIsActive: boolean("archived_previous_is_active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolIdx: index("academy_rooms_school_idx").on(table.schoolId),
  activeIdx: index("academy_rooms_active_idx").on(table.schoolId, table.isActive),
  capacityCheck: check("academy_rooms_capacity_check", sql`${table.capacity} > 0`),
  archivedInactive: check("academy_rooms_archived_inactive", sql`NOT ${table.isArchived} OR NOT ${table.isActive}`),
}));
