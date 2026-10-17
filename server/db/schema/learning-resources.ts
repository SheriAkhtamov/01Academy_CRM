import { sql } from "drizzle-orm";
import { pgTable, text, bigserial, integer, bigint, boolean, timestamp, jsonb, time, index, uniqueIndex, unique, primaryKey, foreignKey, check, type AnyPgColumn } from "drizzle-orm/pg-core";

/** SQL migrations own triggers; these declarations mirror columns, keys, indexes and checks. */
export function createLmsResourceTables(refs: { accountId: AnyPgColumn; linkId: AnyPgColumn; courseId: AnyPgColumn; paymentId: AnyPgColumn; projectId: AnyPgColumn; recipientId: AnyPgColumn; runId: AnyPgColumn; studentId: AnyPgColumn; userId: AnyPgColumn }) {
  const lmsStaffFileCopies = pgTable("lms_staff_file_copies", {
    userId: integer("user_id").notNull(),
    requestKey: text("request_key").notNull(),
    sourceFileId: bigint("source_file_id", { mode: "number" }).notNull(),
    targetRunId: bigint("target_run_id", { mode: "number" }).notNull(),
    fileId: bigint("file_id", { mode: "number" }).notNull(),
  }, (table) => [
    primaryKey({ name: "lms_staff_file_copies_pkey", columns: [table.userId, table.requestKey, table.sourceFileId, table.targetRunId] }),
    foreignKey({ name: "lms_staff_file_copies_user_id_fkey", columns: [table.userId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_staff_file_copies_source_file_id_fkey", columns: [table.sourceFileId], foreignColumns: [lmsFiles.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_staff_file_copies_target_run_id_fkey", columns: [table.targetRunId], foreignColumns: [refs.runId] }).onDelete("restrict"),
    foreignKey({ name: "lms_staff_file_copies_file_id_fkey", columns: [table.fileId], foreignColumns: [lmsFiles.id] }).onDelete("restrict"),
  ]);
  const academyPaymentStudentAllocations = pgTable("academy_payment_student_allocations", {
    paymentId: integer("payment_id").notNull(),
    studentId: integer("student_id").notNull(),
    amountUzs: bigint("amount_uzs", { mode: "number" }).notNull(),
    assignedBy: integer("assigned_by").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("academy_payment_student_allocations_amount_uzs_check", sql.raw("(amount_uzs > 0)")),
    foreignKey({ name: "academy_payment_student_allocations_assigned_by_fkey", columns: [table.assignedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "academy_payment_student_allocations_payment_id_fkey", columns: [table.paymentId], foreignColumns: [refs.paymentId] }).onDelete("restrict"),
    primaryKey({ name: "academy_payment_student_allocations_pkey", columns: [table.paymentId, table.studentId] }),
    check("academy_payment_student_allocations_reason_check", sql.raw("(length(TRIM(BOTH FROM reason)) >= 3)")),
    foreignKey({ name: "academy_payment_student_allocations_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    index("academy_payment_allocations_student").on(table.studentId),
  ]);

  const lmsFeatureFlags = pgTable("lms_feature_flags", {
    key: text("key").notNull().primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    allGroups: boolean("all_groups").notNull().default(false),
    version: integer("version").notNull().default(0),
    groupIds: integer("group_ids").array().notNull().default([]),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_feature_flags_updated_by_fkey", columns: [table.updatedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    check("lms_feature_flags_version_check", sql.raw("(version >= 0)")),
  ]);

  const lmsFiles = pgTable("lms_files", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    ownerAccountId: bigint("owner_account_id", { mode: "number" }),
    ownerUserId: integer("owner_user_id"),
    studentId: integer("student_id"),
    runId: bigint("run_id", { mode: "number" }),
    recipientId: bigint("recipient_id", { mode: "number" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256"),
    state: text("state").$type<"uploading" | "checking" | "ready" | "rejected">().notNull().default("uploading"),
    rejectionCode: text("rejection_code"),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    scanAfter: timestamp("scan_after", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    purpose: text("purpose").$type<'learning' | 'course_material'>().notNull().default('learning'),
    courseId: integer("course_id"),
  }, (table) => [
    check("lms_files_check", sql.raw("((owner_account_id IS NULL) <> (owner_user_id IS NULL))")),
    check("lms_files_check1", sql.raw("((owner_account_id IS NULL) OR (student_id IS NOT NULL))")),
    foreignKey({ name: 'lms_files_course_id_fkey', columns: [table.courseId], foreignColumns: [refs.courseId] }).onDelete('set null'),
    check('lms_files_purpose_check', sql.raw("(purpose = ANY (ARRAY['learning'::text, 'course_material'::text]))")),
    check('lms_files_course_material_scope', sql.raw("(((purpose = 'learning'::text) AND (course_id IS NULL)) OR ((purpose = 'course_material'::text) AND (owner_user_id IS NOT NULL) AND (owner_account_id IS NULL) AND (run_id IS NULL) AND (student_id IS NULL) AND (recipient_id IS NULL)))")),
    index('lms_files_course_idx').on(table.courseId).where(sql.raw("((purpose = 'course_material'::text) AND (deleted_at IS NULL))")),
    check("lms_files_name_check", sql.raw("((length(name) >= 1) AND (length(name) <= 255))")),
    foreignKey({ name: "lms_files_owner_account_id_fkey", columns: [table.ownerAccountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    foreignKey({ name: "lms_files_owner_user_id_fkey", columns: [table.ownerUserId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_files_recipient_id_fkey", columns: [table.recipientId], foreignColumns: [refs.recipientId] }).onDelete("restrict"),
    foreignKey({ name: "lms_files_run_id_fkey", columns: [table.runId], foreignColumns: [refs.runId] }).onDelete("restrict"),
    check("lms_files_scan_attempts_check", sql.raw("(scan_attempts >= 0)")),
    check("lms_files_sha256_check", sql.raw("((sha256 IS NULL) OR (sha256 ~ '^[a-f0-9]{64}$'::text))")),
    check("lms_files_size_bytes_check", sql.raw("((size_bytes >= 0) AND (size_bytes <= 104857600))")),
    check("lms_files_state_check", sql.raw("(state = ANY (ARRAY['uploading'::text, 'checking'::text, 'ready'::text, 'rejected'::text]))")),
    check("lms_files_storage_key_check", sql.raw("(storage_key ~ '^[a-zA-Z0-9_-]{20,80}$'::text)")),
    unique("lms_files_storage_key_key").on(table.storageKey),
    foreignKey({ name: "lms_files_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    index("lms_files_owner").on(table.ownerAccountId, table.studentId).where(sql.raw("(deleted_at IS NULL)")),
    index("lms_files_scan_queue").on(table.scanAfter, table.id).where(sql.raw("((state = 'checking'::text) AND (deleted_at IS NULL))")),
  ]);

  const lmsLegacyImportCheckpoints = pgTable("lms_legacy_import_checkpoints", {
    scope: text("scope").notNull().primaryKey(),
    lastId: bigint("last_id", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
  ]);

  const lmsLegacyImports = pgTable("lms_legacy_imports", {
    sourceType: text("source_type").notNull(),
    sourceId: bigint("source_id", { mode: "number" }).notNull(),
    sourceHash: text("source_hash").notNull(),
    targetType: text("target_type").notNull(),
    targetId: bigint("target_id", { mode: "number" }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    primaryKey({ name: "lms_legacy_imports_pkey", columns: [table.sourceType, table.sourceId] }),
    check("lms_legacy_imports_source_hash_check", sql.raw("(source_hash ~ '^[a-f0-9]{64}$'::text)")),
  ]);

  const lmsLegacyPortfolioDrafts = pgTable("lms_legacy_portfolio_drafts", {
    projectId: integer("project_id").notNull().primaryKey(),
    sourceHash: text("source_hash").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    state: text("state").$type<"draft" | "reviewed">().notNull().default("draft"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_legacy_portfolio_drafts_project_id_fkey", columns: [table.projectId], foreignColumns: [refs.projectId] }).onDelete("cascade"),
    check("lms_legacy_portfolio_drafts_source_hash_check", sql.raw("(source_hash ~ '^[a-f0-9]{64}$'::text)")),
    check("lms_legacy_portfolio_drafts_state_check", sql.raw("(state = ANY (ARRAY['draft'::text, 'reviewed'::text]))")),
  ]);

  const lmsNotificationSources = pgTable("lms_notification_sources", {
    sourceKey: text("source_key").notNull().primaryKey(),
    handledAt: timestamp("handled_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
  ]);

  const lmsNotificationWorkerState = pgTable("lms_notification_worker_state", {
    key: text("key").notNull().primaryKey(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
  ]);

  const lmsPortfolioShares = pgTable("lms_portfolio_shares", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    projectId: integer("project_id").notNull(),
    projectVersion: integer("project_version").notNull(),
    version: integer("version").notNull().default(1),
    tokenHash: text("token_hash").notNull(),
    tokenEnvelope: text("token_envelope").notNull(),
    status: text("status").$type<"awaiting_approval" | "awaiting_moderation" | "published" | "rejected" | "revoked">().notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    requestedBy: bigint("requested_by", { mode: "number" }).notNull(),
    studentConsentAt: timestamp("student_consent_at", { withTimezone: true }).notNull().defaultNow(),
    studentClassification: text("student_classification").$type<"adult" | "minor">().notNull(),
    approvedBy: bigint("approved_by", { mode: "number" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    moderatedBy: integer("moderated_by"),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_portfolio_shares_approved_by_fkey", columns: [table.approvedBy], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    foreignKey({ name: "lms_portfolio_shares_moderated_by_fkey", columns: [table.moderatedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_portfolio_shares_project_id_fkey", columns: [table.projectId], foreignColumns: [refs.projectId] }).onDelete("restrict"),
    check("lms_portfolio_shares_project_version_check", sql.raw("(project_version > 0)")),
    foreignKey({ name: "lms_portfolio_shares_requested_by_fkey", columns: [table.requestedBy], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    check("lms_portfolio_shares_status_check", sql.raw("(status = ANY (ARRAY['awaiting_approval'::text, 'awaiting_moderation'::text, 'published'::text, 'rejected'::text, 'revoked'::text]))")),
    check("lms_portfolio_shares_student_classification_check", sql.raw("(student_classification = ANY (ARRAY['adult'::text, 'minor'::text]))")),
    check("lms_portfolio_shares_token_hash_check", sql.raw("(token_hash ~ '^[a-f0-9]{64}$'::text)")),
    unique("lms_portfolio_shares_token_hash_key").on(table.tokenHash),
    check("lms_portfolio_shares_version_check", sql.raw("(version > 0)")),
    index("lms_portfolio_moderation").on(table.status, table.createdAt),
  ]);

  const lmsProjectComparisons = pgTable("lms_project_comparisons", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }),
    firstProjectId: integer("first_project_id").notNull(),
    latestProjectId: integer("latest_project_id").notNull(),
    firstSnapshot: jsonb("first_snapshot").$type<Record<string, unknown>>().notNull(),
    latestSnapshot: jsonb("latest_snapshot").$type<Record<string, unknown>>().notNull(),
    selectedByAccount: bigint("selected_by_account", { mode: "number" }),
    selectedByUser: integer("selected_by_user"),
    selectedByName: text("selected_by_name").notNull(),
    selectedByRole: text("selected_by_role").$type<"student" | "teacher" | "staff">().notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("lms_project_comparisons_check", sql.raw("(first_project_id <> latest_project_id)")),
    check("lms_project_comparisons_check1", sql.raw("((selected_by_account IS NULL) <> (selected_by_user IS NULL))")),
    foreignKey({ name: "lms_project_comparisons_first_project_id_fkey", columns: [table.firstProjectId], foreignColumns: [refs.projectId] }).onDelete("restrict"),
    foreignKey({ name: "lms_project_comparisons_latest_project_id_fkey", columns: [table.latestProjectId], foreignColumns: [refs.projectId] }).onDelete("restrict"),
    foreignKey({ name: "lms_project_comparisons_run_id_fkey", columns: [table.runId], foreignColumns: [refs.runId] }).onDelete("restrict"),
    foreignKey({ name: "lms_project_comparisons_selected_by_account_fkey", columns: [table.selectedByAccount], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    check("lms_project_comparisons_selected_by_role_check", sql.raw("(selected_by_role = ANY (ARRAY['student'::text, 'teacher'::text, 'staff'::text]))")),
    foreignKey({ name: "lms_project_comparisons_selected_by_user_fkey", columns: [table.selectedByUser], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_project_comparisons_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    unique("lms_project_comparisons_student_id_run_id_key").on(table.studentId, table.runId).nullsNotDistinct(),
    check("lms_project_comparisons_version_check", sql.raw("(version > 0)")),
  ]);

  const lmsResourceAudit = pgTable("lms_resource_audit", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    requestId: text("request_id"),
    portalAccountId: bigint("portal_account_id", { mode: "number" }),
    staffUserId: integer("staff_user_id"),
    studentId: integer("student_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: bigint("entity_id", { mode: "number" }),
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    uniqueIndex("lms_resource_creation_receipt").on(table.portalAccountId, table.action, sql.raw("(changes ->> 'requestKey'::text)")).where(sql.raw("(changes ? 'requestKey'::text)")),
    check("lms_resource_audit_check", sql.raw("((portal_account_id IS NULL) <> (staff_user_id IS NULL))")),
    foreignKey({ name: "lms_resource_audit_portal_account_id_fkey", columns: [table.portalAccountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    foreignKey({ name: "lms_resource_audit_staff_user_id_fkey", columns: [table.staffUserId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_resource_audit_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
  ]);

  const lmsResourceOutbox = pgTable("lms_resource_outbox", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    linkId: bigint("link_id", { mode: "number" }),
    category: text("category").notNull(),
    code: text("code").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    href: text("href"),
    eventKey: text("event_key").notNull(),
    requiredPermission: text("required_permission"),
    channel: text("channel").$type<"in_app">().notNull(),
    urgent: boolean("urgent").notNull().default(false),
    state: text("state").$type<"pending" | "delivered" | "cancelled" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    deliverAfter: timestamp("deliver_after", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    unique("lms_resource_outbox_account_id_event_key_channel_key").on(table.accountId, table.eventKey, table.channel),
    foreignKey({ name: "lms_resource_outbox_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    check("lms_resource_outbox_channel_check", sql.raw("(channel = 'in_app'::text)")),
    foreignKey({ name: "lms_resource_outbox_link_id_fkey", columns: [table.linkId], foreignColumns: [refs.linkId] }).onDelete("restrict"),
    check("lms_resource_outbox_state_check", sql.raw("(state = ANY (ARRAY['pending'::text, 'delivered'::text, 'cancelled'::text, 'failed'::text]))")),
    index("lms_resource_outbox_due").on(table.deliverAfter, table.id).where(sql.raw("(state = 'pending'::text)")),
  ]);

  const lmsSchoolSettings = pgTable("lms_school_settings", {
    singleton: boolean("singleton").notNull().default(true).primaryKey(),
    version: integer("version").notNull().default(0),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default(sql.raw("'{\"crmPreparation\": {\"defaultFormat\": null}, \"maxFileMiB\": 10, \"studentQuotaGiB\": 5, \"schoolQuotaGiB\": 20, \"materialAccessDays\": null, \"achievementTemplates\": [{\"rule\": \"first_accepted\", \"title\": \"lmsAchievementFirstAccepted\", \"reason\": \"lmsAchievementFirstAccepted\"}, {\"rule\": \"first_project\", \"title\": \"lmsAchievementFirstProject\", \"reason\": \"lmsAchievementFirstProject\"}, {\"rule\": \"section_completed\", \"title\": \"lmsAchievementSectionCompleted\", \"reason\": \"lmsAchievementSectionCompleted\"}, {\"rule\": \"makeup_completed\", \"title\": \"portalMakeupComplete\", \"reason\": \"portalMakeupComplete\"}, {\"rule\": \"course_completed\", \"title\": \"lmsAchievementCourseCompleted\", \"reason\": \"lmsAchievementCourseCompleted\"}]}'::jsonb")),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("lms_school_settings_singleton_check", sql.raw("singleton")),
    foreignKey({ name: "lms_school_settings_updated_by_fkey", columns: [table.updatedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    check("lms_school_settings_version_check", sql.raw("(version >= 0)")),
  ]);

  const lmsStaffNotificationEvents = pgTable("lms_staff_notification_events", {
    userId: integer("user_id").notNull(),
    eventKey: text("event_key").notNull(),
  }, (table) => [
    primaryKey({ name: "lms_staff_notification_events_pkey", columns: [table.userId, table.eventKey] }),
    foreignKey({ name: "lms_staff_notification_events_user_id_fkey", columns: [table.userId], foreignColumns: [refs.userId] }).onDelete("restrict"),
  ]);

  const portalFinanceQuestionMessages = pgTable("portal_finance_question_messages", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    questionId: bigint("question_id", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }),
    userId: integer("user_id"),
    body: text("body").notNull(),
    requestKey: text("request_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    unique("portal_finance_question_messa_question_id_account_id_reques_key").on(table.questionId, table.accountId, table.requestKey),
    unique("portal_finance_question_messa_question_id_user_id_request_k_key").on(table.questionId, table.userId, table.requestKey),
    foreignKey({ name: "portal_finance_question_messages_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    check("portal_finance_question_messages_body_check", sql.raw("((length(TRIM(BOTH FROM body)) >= 1) AND (length(TRIM(BOTH FROM body)) <= 10000))")),
    check("portal_finance_question_messages_check", sql.raw("((account_id IS NULL) <> (user_id IS NULL))")),
    foreignKey({ name: "portal_finance_question_messages_question_id_fkey", columns: [table.questionId], foreignColumns: [portalFinanceQuestions.id] }).onDelete("restrict"),
    foreignKey({ name: "portal_finance_question_messages_user_id_fkey", columns: [table.userId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    index("portal_finance_messages_thread").on(table.questionId, table.id),
  ]);

  const portalFinanceQuestions = pgTable("portal_finance_questions", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    paymentId: integer("payment_id"),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    linkId: bigint("link_id", { mode: "number" }).notNull(),
    subject: text("subject").notNull(),
    requestKey: text("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").$type<"open" | "answered" | "resolved">().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "portal_finance_questions_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    unique("portal_finance_questions_account_id_request_key_key").on(table.accountId, table.requestKey),
    foreignKey({ name: "portal_finance_questions_link_id_fkey", columns: [table.linkId], foreignColumns: [refs.linkId] }).onDelete("restrict"),
    foreignKey({ name: "portal_finance_questions_payment_id_fkey", columns: [table.paymentId], foreignColumns: [refs.paymentId] }).onDelete("restrict"),
    check("portal_finance_questions_status_check", sql.raw("(status = ANY (ARRAY['open'::text, 'answered'::text, 'resolved'::text]))")),
    foreignKey({ name: "portal_finance_questions_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    check("portal_finance_questions_subject_check", sql.raw("((length(TRIM(BOTH FROM subject)) >= 1) AND (length(TRIM(BOTH FROM subject)) <= 255))")),
    index("portal_finance_questions_account").on(table.accountId, table.studentId, table.id.desc().nullsFirst()),
    index("portal_finance_questions_queue").on(table.status, table.createdAt),
  ]);

  const portalNotificationPreferences = pgTable("portal_notification_preferences", {
    accountId: bigint("account_id", { mode: "number" }).notNull().primaryKey(),
    categories: jsonb("categories").$type<Record<string, unknown>>().notNull(),
    weeklySummary: boolean("weekly_summary").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "portal_notification_preferences_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
  ]);

  const portalNotifications = pgTable("portal_notifications", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    linkId: bigint("link_id", { mode: "number" }),
    category: text("category").$type<"learning" | "schedule" | "feedback" | "finance" | "family" | "security">().notNull(),
    code: text("code").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    href: text("href"),
    eventKey: text("event_key").notNull(),
    requiredPermission: text("required_permission"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  }, (table) => [
    unique("portal_notifications_account_id_event_key_key").on(table.accountId, table.eventKey),
    foreignKey({ name: "portal_notifications_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    check("portal_notifications_category_check", sql.raw("(category = ANY (ARRAY['learning'::text, 'schedule'::text, 'feedback'::text, 'finance'::text, 'family'::text, 'security'::text]))")),
    foreignKey({ name: "portal_notifications_link_id_fkey", columns: [table.linkId], foreignColumns: [refs.linkId] }).onDelete("restrict"),
    index("portal_notifications_account").on(table.accountId, table.id.desc().nullsFirst()),
    index("portal_notifications_unread").on(table.accountId).where(sql.raw("(read_at IS NULL)")),
  ]);

  return { academyPaymentStudentAllocations, lmsFeatureFlags, lmsFiles, lmsStaffFileCopies, lmsLegacyImportCheckpoints, lmsLegacyImports, lmsLegacyPortfolioDrafts, lmsNotificationSources, lmsNotificationWorkerState, lmsPortfolioShares, lmsProjectComparisons, lmsResourceAudit, lmsResourceOutbox, lmsSchoolSettings, lmsStaffNotificationEvents, portalFinanceQuestionMessages, portalFinanceQuestions, portalNotificationPreferences, portalNotifications };
}
