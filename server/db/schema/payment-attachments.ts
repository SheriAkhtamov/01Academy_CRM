import { check, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { MAX_PAYMENT_ATTACHMENT_BYTES } from '@shared/payment-attachments';

export const createAcademyPaymentAttachmentsTable = (paymentId: AnyPgColumn, userId: AnyPgColumn) =>
  pgTable('academy_payment_attachments', {
    id: serial('id').primaryKey(),
    paymentId: integer('payment_id').notNull().references(() => paymentId, { onDelete: 'cascade' }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    size: integer('size').notNull(),
    uploadedBy: integer('uploaded_by').references(() => userId, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  }, (table) => ({
    paymentIdx: index('academy_payment_attachments_payment_idx').on(table.paymentId),
    fileNameUnique: uniqueIndex('academy_payment_attachments_file_name_unique').on(table.fileName),
    sizeCheck: check('academy_payment_attachments_size_check', sql`${table.size} > 0 AND ${table.size} <= ${MAX_PAYMENT_ATTACHMENT_BYTES}`),
  }));
