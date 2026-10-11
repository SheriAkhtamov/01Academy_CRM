import { sql } from "drizzle-orm";
import { bigint, boolean, integer, jsonb, text, timestamp, check, foreignKey, type AnyPgColumn } from "drizzle-orm/pg-core";

/** Spread into the existing portfolio table; pair with createLearningPortfolioConstraints. */
export function createLearningPortfolioColumns() {
  return {
    description: text("description").notNull().default(""),
    lmsRunId: bigint("lms_run_id", { mode: "number" }),
    sourceSubmissionId: bigint("source_submission_id", { mode: "number" }),
    links: jsonb("links").$type<unknown[]>().notNull().default([]),
    fileIds: jsonb("file_ids").$type<unknown[]>().notNull().default([]),
    coverFileId: bigint("cover_file_id", { mode: "number" }),
    teacherReview: text("teacher_review"),
    reviewedBy: integer("reviewed_by"),
    portalVersion: integer("portal_version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    portalCreated: boolean("portal_created").notNull().default(false),
  };
}
/** Invoke inside pgTable's extra-config callback after the full schema has initialized. */
export function createLearningPortfolioConstraints(
  table: { lmsRunId: AnyPgColumn; sourceSubmissionId: AnyPgColumn; coverFileId: AnyPgColumn; reviewedBy: AnyPgColumn; portalVersion: AnyPgColumn },
  refs: { runId: () => AnyPgColumn; submissionId: () => AnyPgColumn; fileId: () => AnyPgColumn; userId: () => AnyPgColumn },
) {
  return {
    learningRunReference: foreignKey({ name: "academy_portfolio_projects_lms_run_id_fkey", columns: [table.lmsRunId], foreignColumns: [refs.runId()] }).onDelete("restrict"),
    learningSubmissionReference: foreignKey({ name: "academy_portfolio_projects_source_submission_id_fkey", columns: [table.sourceSubmissionId], foreignColumns: [refs.submissionId()] }).onDelete("restrict"),
    learningCoverReference: foreignKey({ name: "academy_portfolio_projects_cover_file_id_fkey", columns: [table.coverFileId], foreignColumns: [refs.fileId()] }).onDelete("restrict"),
    learningReviewerReference: foreignKey({ name: "academy_portfolio_projects_reviewed_by_fkey", columns: [table.reviewedBy], foreignColumns: [refs.userId()] }).onDelete("restrict"),
    learningVersionPositive: check("academy_portfolio_projects_portal_version_check", sql`(${table.portalVersion} > 0)`),
  };
}
