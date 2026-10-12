import { sql } from "drizzle-orm";
import { pgTable, text, bigserial, integer, bigint, boolean, timestamp, jsonb, numeric, index, uniqueIndex, unique, primaryKey, foreignKey, check, type AnyPgColumn } from "drizzle-orm/pg-core";

/** SQL migrations own triggers; these declarations mirror columns, keys, indexes and checks. */
export function createLmsContentTables(refs: { accountId: AnyPgColumn; courseId: AnyPgColumn; enrollmentId: AnyPgColumn; groupId: AnyPgColumn; lessonId: AnyPgColumn; studentId: AnyPgColumn; userId: AnyPgColumn }) {
  const lmsAchievements = pgTable("lms_achievements", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    rule: text("rule").notNull(),
    eventKey: text("event_key").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    awardedBy: integer("awarded_by"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by"),
    revokeReason: text("revoke_reason"),
  }, (table) => [
    foreignKey({ name: "lms_achievements_awarded_by_fkey", columns: [table.awardedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    unique("lms_achievements_event_key_key").on(table.eventKey),
    foreignKey({ name: "lms_achievements_revoked_by_fkey", columns: [table.revokedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_achievements_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_achievements_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    unique("lms_achievements_student_id_run_id_rule_key").on(table.studentId, table.runId, table.rule),
  ]);

  const lmsAnnouncementReads = pgTable("lms_announcement_reads", {
    announcementId: bigint("announcement_id", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_announcement_reads_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    foreignKey({ name: "lms_announcement_reads_announcement_id_fkey", columns: [table.announcementId], foreignColumns: [lmsAnnouncements.id] }).onDelete("restrict"),
    primaryKey({ name: "lms_announcement_reads_pkey", columns: [table.announcementId, table.accountId] }),
  ]);

  const lmsAnnouncements = pgTable("lms_announcements", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience").$type<"students" | "representatives" | "all">().notNull(),
    fileIds: jsonb("file_ids").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    pinnedUntil: timestamp("pinned_until", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: integer("created_by").notNull(),
  }, (table) => [
    check("lms_announcements_audience_check", sql.raw("(audience = ANY (ARRAY['students'::text, 'representatives'::text, 'all'::text]))")),
    foreignKey({ name: "lms_announcements_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_announcements_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
  ]);

  const lmsAssignmentRecipients = pgTable("lms_assignment_recipients", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    assignmentId: bigint("assignment_id", { mode: "number" }).notNull(),
    assignmentVersionId: bigint("assignment_version_id", { mode: "number" }).notNull(),
    enrollmentId: integer("enrollment_id").notNull(),
    studentId: integer("student_id").notNull(),
    status: text("status").$type<"assigned" | "submitted" | "revision_required" | "accepted" | "excused" | "cancelled">().notNull().default("assigned"),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    unique("lms_assignment_recipients_assignment_id_enrollment_id_key").on(table.assignmentId, table.enrollmentId),
    foreignKey({ name: "lms_assignment_recipients_assignment_id_fkey", columns: [table.assignmentId], foreignColumns: [lmsAssignments.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_assignment_recipients_assignment_version_id_fkey", columns: [table.assignmentVersionId], foreignColumns: [lmsAssignmentVersions.id] }).onDelete("restrict"),
    check("lms_assignment_recipients_check", sql.raw("((due_at IS NULL) OR (due_at >= opens_at))")),
    check("lms_assignment_recipients_check1", sql.raw("((closes_at IS NULL) OR (closes_at >= opens_at))")),
    foreignKey({ name: "lms_assignment_recipients_enrollment_id_fkey", columns: [table.enrollmentId], foreignColumns: [refs.enrollmentId] }).onDelete("restrict"),
    check("lms_assignment_recipients_status_check", sql.raw("(status = ANY (ARRAY['assigned'::text, 'submitted'::text, 'revision_required'::text, 'accepted'::text, 'excused'::text, 'cancelled'::text]))")),
    foreignKey({ name: "lms_assignment_recipients_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    check("lms_assignment_recipients_version_check", sql.raw("(version > 0)")),
    index("lms_assignment_student_queue").on(table.studentId, table.status, table.dueAt),
  ]);

  const lmsAssignmentVersions = pgTable("lms_assignment_versions", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    assignmentId: bigint("assignment_id", { mode: "number" }).notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    required: boolean("required").notNull(),
    allowedAnswers: jsonb("allowed_answers").$type<unknown[]>().notNull(),
    fileIds: jsonb("file_ids").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    criteria: jsonb("criteria").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    gradingMode: text("grading_mode").$type<"acceptance" | "points">().notNull(),
    maxScore: numeric("max_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_assignment_versions_assignment_id_fkey", columns: [table.assignmentId], foreignColumns: [lmsAssignments.id] }).onDelete("restrict"),
    unique("lms_assignment_versions_assignment_id_version_key").on(table.assignmentId, table.version),
    check("lms_assignment_versions_check", sql.raw("((grading_mode <> 'points'::text) OR (max_score IS NOT NULL))")),
    check("lms_assignment_versions_grading_mode_check", sql.raw("(grading_mode = ANY (ARRAY['acceptance'::text, 'points'::text]))")),
    check("lms_assignment_versions_max_score_check", sql.raw("(max_score > (0)::numeric)")),
    check("lms_assignment_versions_version_check", sql.raw("(version > 0)")),
  ]);

  const lmsAssignments = pgTable("lms_assignments", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    unitId: bigint("unit_id", { mode: "number" }),
    state: text("state").$type<"draft" | "published" | "archived">().notNull().default("published"),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text("idempotency_key"),
    requestSnapshot: jsonb("request_snapshot").$type<Record<string, unknown>>(),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>(),
  }, (table) => [
    foreignKey({ name: "lms_assignments_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_assignments_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    check("lms_assignments_state_check", sql.raw("(state = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))")),
    foreignKey({ name: "lms_assignments_unit_id_fkey", columns: [table.unitId], foreignColumns: [lmsUnits.id] }).onDelete("restrict"),
    uniqueIndex("lms_assignments_author_idempotency").on(table.createdBy, table.idempotencyKey).where(sql.raw("(idempotency_key IS NOT NULL)")),
  ]);

  const lmsCommentReads = pgTable("lms_comment_reads", {
    commentId: bigint("comment_id", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_comment_reads_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    foreignKey({ name: "lms_comment_reads_comment_id_fkey", columns: [table.commentId], foreignColumns: [lmsComments.id] }).onDelete("restrict"),
    primaryKey({ name: "lms_comment_reads_pkey", columns: [table.commentId, table.accountId] }),
  ]);

  const lmsComments = pgTable("lms_comments", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    recipientId: bigint("recipient_id", { mode: "number" }),
    threadId: bigint("thread_id", { mode: "number" }),
    accountId: bigint("account_id", { mode: "number" }),
    staffUserId: integer("staff_user_id"),
    audience: text("audience").$type<"student_teacher" | "family_teacher" | "staff" | "representative_teacher">().notNull(),
    body: text("body").notNull(),
    fileIds: jsonb("file_ids").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    audienceAccountId: integer("audience_account_id"),
  }, (table) => [
    foreignKey({ name: "lms_comments_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    foreignKey({ name: "lms_comments_audience_account_id_fkey", columns: [table.audienceAccountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    check("lms_comments_audience_check", sql.raw("(audience = ANY (ARRAY['student_teacher'::text, 'family_teacher'::text, 'staff'::text, 'representative_teacher'::text]))")),
    check("lms_comments_check", sql.raw("((account_id IS NULL) <> (staff_user_id IS NULL))")),
    check("lms_comments_check1", sql.raw("((recipient_id IS NULL) <> (thread_id IS NULL))")),
    foreignKey({ name: "lms_comments_recipient_id_fkey", columns: [table.recipientId], foreignColumns: [lmsAssignmentRecipients.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_comments_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_comments_staff_user_id_fkey", columns: [table.staffUserId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_comments_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    foreignKey({ name: "lms_comments_thread_id_fkey", columns: [table.threadId], foreignColumns: [lmsThreads.id] }).onDelete("restrict"),
    check("lms_private_assignment_comment_target", sql.raw("((recipient_id IS NULL) OR (audience <> 'representative_teacher'::text) OR (audience_account_id IS NOT NULL))")),
    index("lms_comments_recipient").on(table.recipientId, table.id),
  ]);

  const lmsCourseCompletions = pgTable("lms_course_completions", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    completedBy: integer("completed_by").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedBy: integer("reopened_by"),
    reason: text("reason"),
  }, (table) => [
    foreignKey({ name: "lms_course_completions_completed_by_fkey", columns: [table.completedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_course_completions_reopened_by_fkey", columns: [table.reopenedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_course_completions_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_course_completions_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    uniqueIndex("lms_one_course_completion").on(table.studentId, table.runId).where(sql.raw("(reopened_at IS NULL)")),
  ]);

  const lmsCourseVersions = pgTable("lms_course_versions", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    courseId: integer("course_id").notNull(),
    version: integer("version").notNull(),
    state: text("state").$type<"draft" | "published" | "archived">().notNull().default("draft"),
    program: jsonb("program").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_course_versions_course_id_fkey", columns: [table.courseId], foreignColumns: [refs.courseId] }).onDelete("restrict"),
    unique("lms_course_versions_course_id_version_key").on(table.courseId, table.version),
    foreignKey({ name: "lms_course_versions_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    check("lms_course_versions_state_check", sql.raw("(state = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))")),
    check("lms_course_versions_version_check", sql.raw("(version > 0)")),
  ]);

  const lmsGroupRuns = pgTable("lms_group_runs", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    groupId: integer("group_id").notNull(),
    courseVersionId: bigint("course_version_id", { mode: "number" }).notNull(),
    status: text("status").$type<"active" | "completed" | "archived">().notNull().default("active"),
    format: text("format").$type<"offline" | "online">().notNull().default("offline"),
    meetingUrl: text("meeting_url"),
    accessUntil: timestamp("access_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  }, (table) => [
    foreignKey({ name: "lms_group_runs_course_version_id_fkey", columns: [table.courseVersionId], foreignColumns: [lmsCourseVersions.id] }).onDelete("restrict"),
    check("lms_group_runs_format_check", sql.raw("(format = ANY (ARRAY['offline'::text, 'online'::text]))")),
    foreignKey({ name: "lms_group_runs_group_id_fkey", columns: [table.groupId], foreignColumns: [refs.groupId] }).onDelete("restrict"),
    unique("lms_group_runs_group_id_key").on(table.groupId),
    check("lms_group_runs_meeting_url_check", sql.raw("((meeting_url IS NULL) OR (meeting_url ~ '^https://'::text))")),
    check("lms_group_runs_status_check", sql.raw("(status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text]))")),
    check("lms_group_runs_version_check", sql.raw("(version > 0)")),
  ]);

  const lmsLearningAudit = pgTable("lms_learning_audit", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    userId: integer("user_id"),
    runId: bigint("run_id", { mode: "number" }),
    entityType: text("entity_type").notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    oldValue: jsonb("old_value").$type<Record<string, unknown>>(),
    newValue: jsonb("new_value").$type<Record<string, unknown>>(),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_learning_audit_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_learning_audit_user_id_fkey", columns: [table.userId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    index("lms_learning_audit_object").on(table.entityType, table.entityId, table.id.desc().nullsFirst()),
  ]);

  const lmsLearningEvents = pgTable("lms_learning_events", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    objectId: bigint("object_id", { mode: "number" }),
    eventKey: text("event_key").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    unique("lms_learning_events_event_key_key").on(table.eventKey),
    foreignKey({ name: "lms_learning_events_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_learning_events_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    index("lms_events_student").on(table.studentId, table.id.desc().nullsFirst()),
  ]);

  const lmsLessonBindings = pgTable("lms_lesson_bindings", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    unitId: bigint("unit_id", { mode: "number" }),
    lessonId: integer("lesson_id").notNull(),
    format: text("format").$type<"offline" | "online">(),
    meetingUrl: text("meeting_url"),
  }, (table) => [
    check("lms_lesson_bindings_format_check", sql.raw("(format = ANY (ARRAY['offline'::text, 'online'::text]))")),
    foreignKey({ name: "lms_lesson_bindings_lesson_id_fkey", columns: [table.lessonId], foreignColumns: [refs.lessonId] }).onDelete("restrict"),
    check("lms_lesson_bindings_meeting_url_check", sql.raw("((meeting_url IS NULL) OR (meeting_url ~ '^https://'::text))")),
    foreignKey({ name: "lms_lesson_bindings_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    unique("lms_lesson_bindings_run_id_lesson_id_key").on(table.runId, table.lessonId),
    foreignKey({ name: "lms_lesson_bindings_unit_id_fkey", columns: [table.unitId], foreignColumns: [lmsUnits.id] }).onDelete("restrict"),
  ]);

  const lmsMakeupPlans = pgTable("lms_makeup_plans", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    lessonId: integer("lesson_id").notNull(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    recipientId: bigint("recipient_id", { mode: "number" }),
    quizRecipientId: bigint("quiz_recipient_id", { mode: "number" }),
    status: text("status").$type<"needed" | "in_progress" | "completed" | "not_required">().notNull().default("needed"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: integer("completed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_makeup_plans_completed_by_fkey", columns: [table.completedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_makeup_plans_lesson_id_fkey", columns: [table.lessonId], foreignColumns: [refs.lessonId] }).onDelete("restrict"),
    unique("lms_makeup_plans_lesson_id_student_id_key").on(table.lessonId, table.studentId),
    foreignKey({ name: "lms_makeup_plans_quiz_recipient_id_fkey", columns: [table.quizRecipientId], foreignColumns: [lmsQuizRecipients.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_makeup_plans_recipient_id_fkey", columns: [table.recipientId], foreignColumns: [lmsAssignmentRecipients.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_makeup_plans_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    check("lms_makeup_plans_status_check", sql.raw("(status = ANY (ARRAY['needed'::text, 'in_progress'::text, 'completed'::text, 'not_required'::text]))")),
    foreignKey({ name: "lms_makeup_plans_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
  ]);

  const lmsMaterialPublications = pgTable("lms_material_publications", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    materialId: bigint("material_id", { mode: "number" }).notNull(),
    materialVersionId: bigint("material_version_id", { mode: "number" }).notNull(),
    enrollmentId: integer("enrollment_id").notNull(),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  }, (table) => [
    foreignKey({ name: "lms_material_publications_enrollment_id_fkey", columns: [table.enrollmentId], foreignColumns: [refs.enrollmentId] }).onDelete("restrict"),
    foreignKey({ name: "lms_material_publications_material_id_fkey", columns: [table.materialId], foreignColumns: [lmsMaterials.id] }).onDelete("restrict"),
    unique("lms_material_publications_material_version_id_enrollment_id_key").on(table.materialVersionId, table.enrollmentId),
    foreignKey({ name: "lms_material_publications_material_version_id_fkey", columns: [table.materialVersionId], foreignColumns: [lmsMaterialVersions.id] }).onDelete("restrict"),
    index("lms_material_publications_due").on(table.publishAt, table.enrollmentId).where(sql.raw("(revoked_at IS NULL)")),
  ]);

  const lmsMaterialReads = pgTable("lms_material_reads", {
    publicationId: bigint("publication_id", { mode: "number" }).notNull(),
    studentId: integer("student_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    primaryKey({ name: "lms_material_reads_pkey", columns: [table.publicationId, table.studentId] }),
    foreignKey({ name: "lms_material_reads_publication_id_fkey", columns: [table.publicationId], foreignColumns: [lmsMaterialPublications.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_material_reads_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
  ]);

  const lmsMaterialVersions = pgTable("lms_material_versions", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    materialId: bigint("material_id", { mode: "number" }).notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").$type<"lesson" | "practice" | "repeat">().notNull(),
    links: jsonb("links").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    fileIds: jsonb("file_ids").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    videoUrl: text("video_url"),
    durationMinutes: integer("duration_minutes"),
  }, (table) => [
    check("lms_material_versions_category_check", sql.raw("(category = ANY (ARRAY['lesson'::text, 'practice'::text, 'repeat'::text]))")),
    foreignKey({ name: "lms_material_versions_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    check("lms_material_versions_duration_minutes_check", sql.raw("((duration_minutes >= 1) AND (duration_minutes <= 1440))")),
    foreignKey({ name: "lms_material_versions_material_id_fkey", columns: [table.materialId], foreignColumns: [lmsMaterials.id] }).onDelete("restrict"),
    unique("lms_material_versions_material_id_version_key").on(table.materialId, table.version),
    check("lms_material_versions_version_check", sql.raw("(version > 0)")),
    check("lms_material_versions_video_url_check", sql.raw("((video_url IS NULL) OR (video_url ~ '^https://'::text))")),
  ]);

  const lmsMaterials = pgTable("lms_materials", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    unitId: bigint("unit_id", { mode: "number" }),
    state: text("state").$type<"draft" | "published" | "archived">().notNull().default("draft"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_materials_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_materials_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    check("lms_materials_state_check", sql.raw("(state = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))")),
    foreignKey({ name: "lms_materials_unit_id_fkey", columns: [table.unitId], foreignColumns: [lmsUnits.id] }).onDelete("restrict"),
  ]);

  const lmsQuizAttempts = pgTable("lms_quiz_attempts", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    recipientId: bigint("recipient_id", { mode: "number" }).notNull(),
    quizVersionId: bigint("quiz_version_id", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    version: integer("version").notNull().default(1),
    state: text("state").$type<"active" | "finished">().notNull().default("active"),
    questions: jsonb("questions").$type<unknown[]>().notNull(),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    score: numeric("score"),
    totalScore: numeric("total_score"),
    percent: numeric("percent"),
    passed: boolean("passed"),
  }, (table) => [
    foreignKey({ name: "lms_quiz_attempts_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    check("lms_quiz_attempts_attempt_number_check", sql.raw("(attempt_number > 0)")),
    foreignKey({ name: "lms_quiz_attempts_quiz_version_id_fkey", columns: [table.quizVersionId], foreignColumns: [lmsQuizVersions.id] }).onDelete("restrict"),
    unique("lms_quiz_attempts_recipient_id_attempt_number_key").on(table.recipientId, table.attemptNumber),
    foreignKey({ name: "lms_quiz_attempts_recipient_id_fkey", columns: [table.recipientId], foreignColumns: [lmsQuizRecipients.id] }).onDelete("restrict"),
    check("lms_quiz_attempts_state_check", sql.raw("(state = ANY (ARRAY['active'::text, 'finished'::text]))")),
    check("lms_quiz_attempts_version_check", sql.raw("(version > 0)")),
    index("lms_quiz_deadlines").on(table.deadlineAt).where(sql.raw("(state = 'active'::text)")),
    uniqueIndex("lms_quiz_one_active").on(table.recipientId).where(sql.raw("(state = 'active'::text)")),
  ]);

  const lmsQuizRecipients = pgTable("lms_quiz_recipients", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    quizId: bigint("quiz_id", { mode: "number" }).notNull(),
    quizVersionId: bigint("quiz_version_id", { mode: "number" }).notNull(),
    enrollmentId: integer("enrollment_id").notNull(),
    studentId: integer("student_id").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    extraAttempts: integer("extra_attempts").notNull().default(0),
    status: text("status").$type<"assigned" | "excused" | "cancelled">().notNull().default("assigned"),
  }, (table) => [
    check("lms_quiz_recipients_check", sql.raw("((closes_at IS NULL) OR (closes_at > opens_at))")),
    foreignKey({ name: "lms_quiz_recipients_enrollment_id_fkey", columns: [table.enrollmentId], foreignColumns: [refs.enrollmentId] }).onDelete("restrict"),
    check("lms_quiz_recipients_extra_attempts_check", sql.raw("(extra_attempts >= 0)")),
    unique("lms_quiz_recipients_quiz_id_enrollment_id_key").on(table.quizId, table.enrollmentId),
    foreignKey({ name: "lms_quiz_recipients_quiz_id_fkey", columns: [table.quizId], foreignColumns: [lmsQuizzes.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_quiz_recipients_quiz_version_id_fkey", columns: [table.quizVersionId], foreignColumns: [lmsQuizVersions.id] }).onDelete("restrict"),
    check("lms_quiz_recipients_status_check", sql.raw("(status = ANY (ARRAY['assigned'::text, 'excused'::text, 'cancelled'::text]))")),
    foreignKey({ name: "lms_quiz_recipients_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    index("lms_quiz_student").on(table.studentId, table.status),
  ]);

  const lmsQuizVersions = pgTable("lms_quiz_versions", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    quizId: bigint("quiz_id", { mode: "number" }).notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    required: boolean("required").notNull(),
    questions: jsonb("questions").$type<unknown[]>().notNull(),
    passPercent: numeric("pass_percent").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    timerSeconds: integer("timer_seconds"),
    disclosure: text("disclosure").$type<"practice" | "closed" | "exhausted">().notNull(),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
    shuffleOptions: boolean("shuffle_options").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("lms_quiz_versions_disclosure_check", sql.raw("(disclosure = ANY (ARRAY['practice'::text, 'closed'::text, 'exhausted'::text]))")),
    check("lms_quiz_versions_max_attempts_check", sql.raw("(max_attempts > 0)")),
    check("lms_quiz_versions_pass_percent_check", sql.raw("((pass_percent >= (0)::numeric) AND (pass_percent <= (100)::numeric))")),
    check("lms_quiz_versions_questions_check", sql.raw("(jsonb_array_length(questions) > 0)")),
    foreignKey({ name: "lms_quiz_versions_quiz_id_fkey", columns: [table.quizId], foreignColumns: [lmsQuizzes.id] }).onDelete("restrict"),
    unique("lms_quiz_versions_quiz_id_version_key").on(table.quizId, table.version),
    check("lms_quiz_versions_timer_seconds_check", sql.raw("(timer_seconds >= 30)")),
    check("lms_quiz_versions_version_check", sql.raw("(version > 0)")),
  ]);

  const lmsQuizzes = pgTable("lms_quizzes", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    unitId: bigint("unit_id", { mode: "number" }),
    state: text("state").$type<"draft" | "published" | "archived">().notNull().default("published"),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_quizzes_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_quizzes_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    check("lms_quizzes_state_check", sql.raw("(state = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))")),
    foreignKey({ name: "lms_quizzes_unit_id_fkey", columns: [table.unitId], foreignColumns: [lmsUnits.id] }).onDelete("restrict"),
  ]);

  const lmsReports = pgTable("lms_reports", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    version: integer("version").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    comment: text("comment").notNull(),
    nextSteps: text("next_steps").notNull(),
    publishedBy: integer("published_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    bestProjects: jsonb("best_projects").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
  }, (table) => [
    check("lms_reports_best_projects_check", sql.raw("(jsonb_typeof(best_projects) = 'array'::text)")),
    check("lms_reports_check", sql.raw("(period_to > period_from)")),
    foreignKey({ name: "lms_reports_published_by_fkey", columns: [table.publishedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    foreignKey({ name: "lms_reports_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_reports_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    unique("lms_reports_student_id_run_id_period_from_period_to_version_key").on(table.studentId, table.runId, table.periodFrom, table.periodTo, table.version),
    check("lms_reports_version_check", sql.raw("(version > 0)")),
    index("lms_reports_student").on(table.studentId, table.publishedAt.desc().nullsFirst()),
  ]);

  const lmsReviews = pgTable("lms_reviews", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    submissionId: bigint("submission_id", { mode: "number" }).notNull(),
    decision: text("decision").$type<"accepted" | "revision_required">().notNull(),
    comment: text("comment").notNull().default(""),
    score: numeric("score"),
    criterionScores: jsonb("criterion_scores").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
    reviewerId: integer("reviewer_id").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("lms_reviews_check", sql.raw("((decision <> 'revision_required'::text) OR (length(TRIM(BOTH FROM comment)) > 0))")),
    check("lms_reviews_decision_check", sql.raw("(decision = ANY (ARRAY['accepted'::text, 'revision_required'::text]))")),
    foreignKey({ name: "lms_reviews_reviewer_id_fkey", columns: [table.reviewerId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    check("lms_reviews_score_check", sql.raw("(score >= (0)::numeric)")),
    foreignKey({ name: "lms_reviews_submission_id_fkey", columns: [table.submissionId], foreignColumns: [lmsSubmissions.id] }).onDelete("restrict"),
  ]);

  const lmsSections = pgTable("lms_sections", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    courseVersionId: bigint("course_version_id", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
  }, (table) => [
    foreignKey({ name: "lms_sections_course_version_id_fkey", columns: [table.courseVersionId], foreignColumns: [lmsCourseVersions.id] }).onDelete("restrict"),
    unique("lms_sections_course_version_id_position_key").on(table.courseVersionId, table.position),
    check("lms_sections_position_check", sql.raw("(\"position\" >= 0)")),
  ]);

  const lmsStaffPermissions = pgTable("lms_staff_permissions", {
    userId: integer("user_id").notNull(),
    permission: text("permission").$type<"content.manage" | "assignments.manage" | "reviews.manage" | "quizzes.manage" | "results.manage" | "communication.manage" | "announcements.manage" | "schedule.manage" | "access.manage" | "portfolio.moderate">().notNull(),
  }, (table) => [
    check("lms_staff_permission_allowlist", sql.raw("(permission = ANY (ARRAY['content.manage'::text, 'assignments.manage'::text, 'reviews.manage'::text, 'quizzes.manage'::text, 'results.manage'::text, 'communication.manage'::text, 'announcements.manage'::text, 'schedule.manage'::text, 'access.manage'::text, 'portfolio.moderate'::text]))")),
    primaryKey({ name: "lms_staff_permissions_pkey", columns: [table.userId, table.permission] }),
    foreignKey({ name: "lms_staff_permissions_user_id_fkey", columns: [table.userId], foreignColumns: [refs.userId] }).onDelete("restrict"),
  ]);

  const lmsSubmissionDrafts = pgTable("lms_submission_drafts", {
    recipientId: bigint("recipient_id", { mode: "number" }).notNull().primaryKey(),
    version: integer("version").notNull().default(1),
    text: text("text").notNull().default(""),
    links: jsonb("links").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    fileIds: jsonb("file_ids").$type<unknown[]>().notNull().default(sql.raw("'[]'::jsonb")),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    foreignKey({ name: "lms_submission_drafts_recipient_id_fkey", columns: [table.recipientId], foreignColumns: [lmsAssignmentRecipients.id] }).onDelete("restrict"),
    check("lms_submission_drafts_version_check", sql.raw("(version > 0)")),
  ]);

  const lmsSubmissions = pgTable("lms_submissions", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    recipientId: bigint("recipient_id", { mode: "number" }).notNull(),
    assignmentVersionId: bigint("assignment_version_id", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    text: text("text").notNull(),
    links: jsonb("links").$type<unknown[]>().notNull(),
    fileIds: jsonb("file_ids").$type<unknown[]>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    late: boolean("late").notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    reviewStartedBy: integer("review_started_by"),
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    receiptSnapshot: jsonb("receipt_snapshot").$type<Record<string, unknown>>(),
  }, (table) => [
    foreignKey({ name: "lms_submissions_account_id_fkey", columns: [table.accountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    unique("lms_submissions_account_id_recipient_id_idempotency_key_key").on(table.accountId, table.recipientId, table.idempotencyKey),
    foreignKey({ name: "lms_submissions_assignment_version_id_fkey", columns: [table.assignmentVersionId], foreignColumns: [lmsAssignmentVersions.id] }).onDelete("restrict"),
    check("lms_submissions_attempt_number_check", sql.raw("(attempt_number > 0)")),
    unique("lms_submissions_recipient_id_attempt_number_key").on(table.recipientId, table.attemptNumber),
    foreignKey({ name: "lms_submissions_recipient_id_fkey", columns: [table.recipientId], foreignColumns: [lmsAssignmentRecipients.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_submissions_review_started_by_fkey", columns: [table.reviewStartedBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    index("lms_submissions_review_queue").on(table.submittedAt, table.recipientId).where(sql.raw("(withdrawn_at IS NULL)")),
  ]);

  const lmsThreads = pgTable("lms_threads", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    studentId: integer("student_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    unitId: bigint("unit_id", { mode: "number" }),
    recipientId: bigint("recipient_id", { mode: "number" }),
    title: text("title").notNull(),
    audience: text("audience").$type<"student_teacher" | "representative_teacher">().notNull(),
    authorAccountId: bigint("author_account_id", { mode: "number" }).notNull(),
    assignedUserId: integer("assigned_user_id"),
    status: text("status").$type<"open" | "answered" | "resolved">().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    quizAttemptId: bigint("quiz_attempt_id", { mode: "number" }),
    stepUrl: text("step_url"),
  }, (table) => [
    foreignKey({ name: "lms_threads_assigned_user_id_fkey", columns: [table.assignedUserId], foreignColumns: [refs.userId] }).onDelete("restrict"),
    check("lms_threads_audience_check", sql.raw("(audience = ANY (ARRAY['student_teacher'::text, 'representative_teacher'::text]))")),
    foreignKey({ name: "lms_threads_author_account_id_fkey", columns: [table.authorAccountId], foreignColumns: [refs.accountId] }).onDelete("restrict"),
    foreignKey({ name: "lms_threads_quiz_attempt_id_fkey", columns: [table.quizAttemptId], foreignColumns: [lmsQuizAttempts.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_threads_recipient_id_fkey", columns: [table.recipientId], foreignColumns: [lmsAssignmentRecipients.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_threads_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    check("lms_threads_status_check", sql.raw("(status = ANY (ARRAY['open'::text, 'answered'::text, 'resolved'::text]))")),
    check("lms_threads_step_url_check", sql.raw("((step_url IS NULL) OR (step_url ~ '^https://'::text))")),
    foreignKey({ name: "lms_threads_student_id_fkey", columns: [table.studentId], foreignColumns: [refs.studentId] }).onDelete("restrict"),
    foreignKey({ name: "lms_threads_unit_id_fkey", columns: [table.unitId], foreignColumns: [lmsUnits.id] }).onDelete("restrict"),
    index("lms_threads_queue").on(table.assignedUserId, table.status, table.createdAt),
  ]);

  const lmsUnitPreviews = pgTable("lms_unit_previews", {
    runId: bigint("run_id", { mode: "number" }).notNull(),
    unitId: bigint("unit_id", { mode: "number" }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    visibleFrom: timestamp("visible_from", { withTimezone: true }).notNull(),
    openAt: timestamp("open_at", { withTimezone: true }).notNull(),
    createdBy: integer("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    check("lms_unit_previews_check", sql.raw("(open_at >= visible_from)")),
    foreignKey({ name: "lms_unit_previews_created_by_fkey", columns: [table.createdBy], foreignColumns: [refs.userId] }).onDelete("restrict"),
    primaryKey({ name: "lms_unit_previews_pkey", columns: [table.runId, table.unitId] }),
    foreignKey({ name: "lms_unit_previews_run_id_fkey", columns: [table.runId], foreignColumns: [lmsGroupRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "lms_unit_previews_unit_id_fkey", columns: [table.unitId], foreignColumns: [lmsUnits.id] }).onDelete("restrict"),
    index("lms_unit_previews_due").on(table.runId, table.visibleFrom).where(sql.raw("enabled")),
  ]);

  const lmsUnits = pgTable("lms_units", {
    id: bigserial("id", { mode: "number" }).notNull().primaryKey(),
    courseVersionId: bigint("course_version_id", { mode: "number" }).notNull(),
    sectionId: bigint("section_id", { mode: "number" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    required: boolean("required").notNull().default(true),
  }, (table) => [
    foreignKey({ name: "lms_units_course_version_id_fkey", columns: [table.courseVersionId], foreignColumns: [lmsCourseVersions.id] }).onDelete("restrict"),
    unique("lms_units_course_version_id_position_key").on(table.courseVersionId, table.position),
    check("lms_units_position_check", sql.raw("(\"position\" >= 0)")),
    foreignKey({ name: "lms_units_section_id_fkey", columns: [table.sectionId], foreignColumns: [lmsSections.id] }).onDelete("restrict"),
  ]);

  return { lmsAchievements, lmsAnnouncementReads, lmsAnnouncements, lmsAssignmentRecipients, lmsAssignmentVersions, lmsAssignments, lmsCommentReads, lmsComments, lmsCourseCompletions, lmsCourseVersions, lmsGroupRuns, lmsLearningAudit, lmsLearningEvents, lmsLessonBindings, lmsMakeupPlans, lmsMaterialPublications, lmsMaterialReads, lmsMaterialVersions, lmsMaterials, lmsQuizAttempts, lmsQuizRecipients, lmsQuizVersions, lmsQuizzes, lmsReports, lmsReviews, lmsSections, lmsStaffPermissions, lmsSubmissionDrafts, lmsSubmissions, lmsThreads, lmsUnitPreviews, lmsUnits };
}
