import { boolean, index, integer, pgTable, serial, text, timestamp, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createLearningPortfolioColumns, createLearningPortfolioConstraints } from "./learning-portfolio-columns";
import { createInsertSchema } from "drizzle-zod";

export function createAcademyPortfolioProjectsTable(refs: {
  studentId: AnyPgColumn; lessonId: AnyPgColumn; groupId: AnyPgColumn; courseId: AnyPgColumn; userId: AnyPgColumn;
  runId: () => AnyPgColumn; submissionId: () => AnyPgColumn; fileId: () => AnyPgColumn;
}) {
  return pgTable("academy_portfolio_projects", {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").references(() => refs.studentId, { onDelete: "cascade" }).notNull(),
    lessonId: integer("lesson_id").references(() => refs.lessonId, { onDelete: "set null" }),
    groupId: integer("group_id").references(() => refs.groupId, { onDelete: "set null" }),
    courseId: integer("course_id").references(() => refs.courseId, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    url: text("url"), fileUrl: text("file_url"),
    finalStatus: varchar("final_status", { length: 80 }).notNull().default("not_started"),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(), updatedAt: timestamp("updated_at").defaultNow(),
    ...createLearningPortfolioColumns(),
  }, (table) => ({
    studentIdx: index("academy_portfolio_projects_student_idx").on(table.studentId),
    ...createLearningPortfolioConstraints(table, { runId: refs.runId, submissionId: refs.submissionId, fileId: refs.fileId, userId: () => refs.userId }),
  }));
}

/** Existing CRM project creation cannot write portal review, ownership or publication fields. */
export function createPublicAcademyPortfolioProjectInsertSchema(table: ReturnType<typeof createAcademyPortfolioProjectsTable>) {
  return createInsertSchema(table).omit({
    id: true, createdAt: true, updatedAt: true,
    description: true, lmsRunId: true, sourceSubmissionId: true, links: true, fileIds: true,
    coverFileId: true, teacherReview: true, reviewedBy: true, portalVersion: true, portalCreated: true, archivedAt: true,
  });
}
