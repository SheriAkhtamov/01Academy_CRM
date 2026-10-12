import { pgTable, serial, varchar, jsonb, integer, timestamp, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { UpdateContent } from '@shared/contracts/platform-updates';

export function createPlatformUpdatesTable(userId: AnyPgColumn) {
  return pgTable('platform_updates', {
    id: serial('id').primaryKey(),
    publicationKey: varchar('publication_key', { length: 100 }).notNull().unique(),
    content: jsonb('content').$type<UpdateContent>().notNull(),
    createdBy: integer('created_by').references(() => userId, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  }, (table) => ({
    publishedIdx: index('platform_updates_published_idx').on(table.publishedAt.desc(), table.id.desc()),
    contentObject: check('platform_updates_content_check', sql`jsonb_typeof(${table.content}) = 'object'`),
  }));
}
