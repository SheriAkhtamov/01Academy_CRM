import { sql } from "drizzle-orm";
import { pgTable, text, serial, bigserial, integer, timestamp, varchar, jsonb, date, uuid, index, uniqueIndex, unique, primaryKey, foreignKey, check, type AnyPgColumn } from "drizzle-orm/pg-core";

/** SQL migrations own triggers; these declarations mirror columns, keys, indexes and checks. */
export function createPortalIdentityTables(refs: { studentId: AnyPgColumn; userId: AnyPgColumn }) {
  const portalAccessAudit = pgTable("portal_access_audit", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    actorKind: varchar("actor_kind", { length: 10 }).$type<"staff" | "portal" | "anonymous" | "system">().notNull(),
    staffId: integer("staff_id"),
    accountId: integer("account_id"),
    studentId: integer("student_id"),
    action: varchar("action", { length: 80 }).notNull(),
    requestId: varchar("request_id", { length: 120 }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "portal_access_audit_account_id_fkey", columns: [table.accountId], foreignColumns: [portalAccounts.id] }).onDelete("set null"),
    check("portal_access_audit_actor_kind_check", sql.raw("((actor_kind)::text = ANY ((ARRAY['staff'::character varying, 'portal'::character varying, 'anonymous'::character varying, 'system'::character varying])::text[]))")),
    check("portal_access_audit_check", sql.raw("((((actor_kind)::text = 'staff'::text) AND (account_id IS NULL)) OR (((actor_kind)::text = 'portal'::text) AND (staff_id IS NULL)) OR (((actor_kind)::text = ANY ((ARRAY['anonymous'::character varying,'system'::character varying])::text[])) AND (account_id IS NULL) AND (staff_id IS NULL)))")),
    foreignKey({ name: "portal_access_audit_staff_id_fkey", columns: [table.staffId], foreignColumns: [refs.userId] }).onDelete("set null"),
    foreignKey({ name: "portal_access_audit_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("set null"),
    index("portal_access_audit_student_idx").on(table.studentId, table.createdAt.desc().nullsFirst()),
  ]);

  const portalAccountContacts = pgTable("portal_account_contacts", {
    id: serial("id").notNull().primaryKey(),
    accountId: integer("account_id").notNull(),
    kind: varchar("kind", { length: 10 }).$type<"email" | "phone">().notNull(),
    normalizedValue: varchar("normalized_value", { length: 254 }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationMethod: varchar("verification_method", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "portal_account_contacts_account_id_fkey", columns: [table.accountId], foreignColumns: [portalAccounts.id] }).onDelete("cascade"),
    unique("portal_account_contacts_account_id_kind_normalized_value_key").on(table.accountId, table.kind, table.normalizedValue),
    check("portal_account_contacts_kind_check", sql.raw("((kind)::text = ANY ((ARRAY['email'::character varying, 'phone'::character varying])::text[]))")),
  ]);

  const portalAccounts = pgTable("portal_accounts", {
    id: serial("id").notNull().primaryKey(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    login: varchar("login", { length: 32 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 50 }),
    locale: varchar("locale", { length: 5 }).$type<"ru" | "en">().notNull().default("ru"),
    status: varchar("status", { length: 16 }).$type<"pending" | "active" | "suspended" | "archived">().notNull().default("pending"),
    passwordHash: text("password_hash"),
    authVersion: integer("auth_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("portal_accounts_auth_version_check", sql.raw("(auth_version > 0)")),
    check("portal_accounts_check1", sql.raw("(((status)::text <> 'active'::text) OR (password_hash IS NOT NULL))")),
    check("portal_accounts_email_check", sql.raw("((email IS NULL) OR ((email)::text = lower((email)::text)))")),
    check("portal_accounts_locale_check", sql.raw("((locale)::text = ANY ((ARRAY['ru'::character varying, 'en'::character varying])::text[]))")),
    check("portal_accounts_login_check", sql.raw("(((login)::text = lower((login)::text)) AND ((login)::text ~ '^[a-z0-9._-]{4,32}$'::text))")),
    unique("portal_accounts_login_key").on(table.login),
    check("portal_accounts_status_check", sql.raw("((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'suspended'::character varying, 'archived'::character varying])::text[]))")),
  ]);

  const portalConsents = pgTable("portal_consents", {
    id: serial("id").notNull().primaryKey(),
    linkId: integer("link_id").notNull(),
    permissions: jsonb("permissions").$type<unknown[]>().notNull(),
    subjectAccountId: integer("subject_account_id"),
    method: varchar("method", { length: 30 }).$type<"in_person" | "portal" | "staff_verification">().notNull(),
    staffId: integer("staff_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("portal_consents_check", sql.raw("(NOT ((subject_account_id IS NOT NULL) AND (staff_id IS NOT NULL)))")),
    foreignKey({ name: "portal_consents_link_id_fkey", columns: [table.linkId], foreignColumns: [portalStudentLinks.id] }).onDelete("restrict"),
    check("portal_consents_method_check", sql.raw("((method)::text = ANY ((ARRAY['in_person'::character varying, 'portal'::character varying, 'staff_verification'::character varying])::text[]))")),
    check("portal_consents_permissions_check", sql.raw("(jsonb_typeof(permissions) = 'array'::text)")),
    foreignKey({ name: "portal_consents_staff_id_fkey", columns: [table.staffId], foreignColumns: [refs.userId] }).onDelete("set null"),
    foreignKey({ name: "portal_consents_subject_account_id_fkey", columns: [table.subjectAccountId], foreignColumns: [portalAccounts.id] }).onDelete("set null"),
  ]);

  const portalInvitations = pgTable("portal_invitations", {
    id: serial("id").notNull().primaryKey(),
    accountId: integer("account_id").notNull(),
    linkId: integer("link_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 20 }).$type<"created" | "sent" | "delivery_failed" | "accepted" | "expired" | "revoked">().notNull().default("created"),
    channel: varchar("channel", { length: 10 }).$type<"manual">().notNull(),
    createdBy: integer("created_by"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedAccountId: integer("accepted_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "portal_invitations_accepted_account_id_fkey", columns: [table.acceptedAccountId], foreignColumns: [portalAccounts.id] }).onDelete("set null"),
    foreignKey({ name: "portal_invitations_account_id_fkey", columns: [table.accountId], foreignColumns: [portalAccounts.id] }).onDelete("restrict"),
    check("portal_invitations_channel_check", sql.raw("((channel)::text = 'manual'::text)")),
    foreignKey({ name: "portal_invitations_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("set null"),
    unique("portal_invitations_idempotency_key_key").on(table.idempotencyKey),
    foreignKey({ name: "portal_invitations_link_id_fkey", columns: [table.linkId], foreignColumns: [portalStudentLinks.id] }).onDelete("restrict"),
    check("portal_invitations_status_check", sql.raw("((status)::text = ANY ((ARRAY['created'::character varying, 'sent'::character varying, 'delivery_failed'::character varying, 'accepted'::character varying, 'expired'::character varying, 'revoked'::character varying])::text[]))")),
    unique("portal_invitations_token_hash_key").on(table.tokenHash),
    index("portal_invitations_link_idx").on(table.linkId, table.id.desc().nullsFirst()),
  ]);

  const portalRateLimits = pgTable("portal_rate_limits", {
    key: varchar("key", { length: 100 }).notNull().primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  }, (table) => [
    check("portal_rate_limits_count_check", sql.raw("(count >= 0)")),
    index("portal_rate_limits_reset_idx").on(table.resetAt),
  ]);

  const portalSessions = pgTable("portal_sessions", {
    id: varchar("id", { length: 64 }).notNull().primaryKey(),
    accountId: integer("account_id"),
    authVersion: integer("auth_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    csrfToken: varchar("csrf_token", { length: 64 }).notNull(),
    reauthenticatedAt: timestamp("reauthenticated_at", { withTimezone: true }),
  }, (table) => [
    foreignKey({ name: "portal_sessions_account_id_fkey", columns: [table.accountId], foreignColumns: [portalAccounts.id] }).onDelete("cascade"),
    index("portal_sessions_account_idx").on(table.accountId),
    index("portal_sessions_expiry_idx").on(table.absoluteExpiresAt),
  ]);

  const portalStudentIdentity = pgTable("portal_student_identity", {
    studentId: integer("student_id").notNull().primaryKey(),
    classification: varchar("classification", { length: 16 }).$type<"adult" | "minor" | "unverified">().notNull().default("unverified"),
    verifiedBirthDate: date("verified_birth_date"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    verifiedBy: integer("verified_by"),
    verificationMethod: varchar("verification_method", { length: 120 }).notNull(),
  }, (table) => [
    check("portal_student_identity_classification_check", sql.raw("((classification)::text = ANY ((ARRAY['adult'::character varying, 'minor'::character varying, 'unverified'::character varying])::text[]))")),
    foreignKey({ name: "portal_student_identity_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("cascade"),
    foreignKey({ name: "portal_student_identity_verified_by_fkey", columns: [table.verifiedBy], foreignColumns: [refs.userId] }).onDelete("set null"),
  ]);

  const portalStudentLinks = pgTable("portal_student_links", {
    id: serial("id").notNull().primaryKey(),
    accountId: integer("account_id").notNull(),
    studentId: integer("student_id").notNull(),
    kind: varchar("kind", { length: 20 }).$type<"self" | "representative">().notNull(),
    relationship: varchar("relationship", { length: 20 }).$type<"parent" | "guardian" | "payer" | "other">(),
    permissions: jsonb("permissions").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    status: varchar("status", { length: 16 }).$type<"pending" | "active" | "suspended" | "revoked">().notNull().default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: integer("verified_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "portal_student_links_account_id_fkey", columns: [table.accountId], foreignColumns: [portalAccounts.id] }).onDelete("restrict"),
    check("portal_student_links_check", sql.raw("((((kind)::text = 'self'::text) AND (relationship IS NULL)) OR (((kind)::text = 'representative'::text) AND (relationship IS NOT NULL)))")),
    check("portal_student_links_check1", sql.raw("(((kind)::text = 'self'::text) OR (NOT (permissions ?| ARRAY['assignments.submit'::text, 'quizzes.attempt'::text, 'portfolio.edit'::text])))")),
    check("portal_student_links_check2", sql.raw("(((status)::text <> 'active'::text) OR (verified_at IS NOT NULL))")),
    check("portal_student_links_kind_check", sql.raw("((kind)::text = ANY ((ARRAY['self'::character varying, 'representative'::character varying])::text[]))")),
    check("portal_student_links_permissions_check", sql.raw("(jsonb_typeof(permissions) = 'array'::text)")),
    check("portal_student_links_permissions_check1", sql.raw("(permissions <@ '[\"learning.read\", \"attendance.read\", \"feedback.read\", \"finance.read\", \"communication.create\", \"portfolio.approve\", \"child_credentials.manage\", \"assignments.submit\", \"quizzes.attempt\", \"portfolio.edit\"]'::jsonb)")),
    check("portal_student_links_relationship_check", sql.raw("((relationship)::text = ANY ((ARRAY['parent'::character varying, 'guardian'::character varying, 'payer'::character varying, 'other'::character varying])::text[]))")),
    check("portal_student_links_status_check", sql.raw("((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'suspended'::character varying, 'revoked'::character varying])::text[]))")),
    foreignKey({ name: "portal_student_links_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    foreignKey({ name: "portal_student_links_verified_by_fkey", columns: [table.verifiedBy], foreignColumns: [refs.userId] }).onDelete("set null"),
    index("portal_student_links_account_idx").on(table.accountId, table.status),
    uniqueIndex("portal_student_links_live_pair_unique").on(table.accountId, table.studentId).where(sql.raw("((status)::text <> 'revoked'::text)")),
    uniqueIndex("portal_student_links_self_account_unique").on(table.accountId).where(sql.raw("(((kind)::text = 'self'::text) AND ((status)::text <> 'revoked'::text))")),
    uniqueIndex("portal_student_links_self_student_unique").on(table.studentId).where(sql.raw("(((kind)::text = 'self'::text) AND ((status)::text <> 'revoked'::text))")),
  ]);

  return { portalAccessAudit, portalAccountContacts, portalAccounts, portalConsents, portalInvitations, portalRateLimits, portalSessions, portalStudentIdentity, portalStudentLinks };
}
