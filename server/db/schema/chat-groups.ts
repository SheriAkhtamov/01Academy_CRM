import { sql } from 'drizzle-orm';
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, primaryKey, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { MessageAttachment } from '@shared/contracts/messages';

export const createChatGroupTables = (userId: AnyPgColumn) => {
  const chatGroups = pgTable('chat_groups', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    createdBy: integer('created_by').notNull().references(() => userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  });
  const chatGroupMembers = pgTable('chat_group_members', {
    groupId: integer('group_id').notNull().references(() => chatGroups.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => userId, { onDelete: 'cascade' }),
    lastReadMessageId: integer('last_read_message_id').notNull().default(0),
  }, (table) => ({ key: primaryKey({ columns: [table.groupId, table.userId] }), userIdx: index('chat_group_members_user_idx').on(table.userId) }));
  const chatGroupMessages = pgTable('chat_group_messages', {
    id: serial('id').primaryKey(),
    groupId: integer('group_id').notNull().references(() => chatGroups.id, { onDelete: 'cascade' }),
    senderId: integer('sender_id').notNull().references(() => userId, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    attachments: jsonb('attachments').$type<MessageAttachment[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  }, (table) => ({ groupIdx: index('chat_group_messages_group_idx').on(table.groupId, table.id), attachmentsArray: check('chat_group_messages_attachments_array', sql`jsonb_typeof(${table.attachments}) = 'array'`) }));
  return { chatGroups, chatGroupMembers, chatGroupMessages };
};
