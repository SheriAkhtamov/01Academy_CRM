import { sql } from 'drizzle-orm';
import { pgTable, integer, text, timestamp, varchar, foreignKey, check, type AnyPgColumn } from 'drizzle-orm/pg-core';

export function createPortalCredentialTables(refs: { accountId: AnyPgColumn; leadId: AnyPgColumn; studentId: AnyPgColumn; userId: AnyPgColumn }) {
  const portalInitialCredentials = pgTable('portal_initial_credentials', {
    accountId: integer('account_id').primaryKey().notNull(),
    authVersion: integer('auth_version').notNull(),
    encryptedPassword: text('encrypted_password'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => [
    foreignKey({ name: 'portal_initial_credentials_account_fkey', columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete('cascade'),
    check('portal_initial_credentials_version_check', sql.raw('(auth_version > 0)')),
  ]);
  const portalLeadAccounts = pgTable('portal_lead_accounts', {
    leadId: integer('lead_id').primaryKey().notNull(),
    accountId: integer('account_id').notNull(),
    role: varchar('role', { length: 16 }).$type<'self' | 'representative'>().notNull(),
    studentId: integer('student_id'),
    verifiedBy: integer('verified_by'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => [
    foreignKey({ name: 'portal_lead_accounts_lead_fkey', columns: [table.leadId], foreignColumns: [refs.leadId] }).onDelete('cascade'),
    foreignKey({ name: 'portal_lead_accounts_account_fkey', columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete('restrict'),
    foreignKey({ name: 'portal_lead_accounts_student_fkey', columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete('restrict'),
    foreignKey({ name: 'portal_lead_accounts_verifier_fkey', columns: [table.verifiedBy], foreignColumns: [refs.userId] }).onDelete('set null'),
    check('portal_lead_accounts_role_check', sql.raw("((role)::text = ANY ((ARRAY['self'::character varying,'representative'::character varying])::text[]))")),
    check('portal_lead_accounts_student_check', sql.raw("((((role)::text = 'self'::text) AND (student_id IS NOT NULL)) OR (((role)::text = 'representative'::text) AND (student_id IS NULL)))")),
  ]);
  return { portalInitialCredentials, portalLeadAccounts };
}
