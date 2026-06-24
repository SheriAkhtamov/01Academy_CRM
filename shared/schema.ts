import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, boolean, timestamp, varchar, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { ACADEMY_WORKSPACES } from "./academy";

export interface AcademyCourseProgramLesson {
  lessonNumber: number;
  topic: string;
  description?: string | null;
  materials?: string | null;
}

export interface AcademyScheduleItem {
  dayOfWeek: number;
  time?: string;
  startTime?: string;
  endTime?: string;
  schoolId?: number | null;
}

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  password: text("password").notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  dateOfBirth: timestamp("date_of_birth"),
  position: varchar("position", { length: 255 }),
  baseSalaryUzs: integer("base_salary_uzs").notNull().default(0),
  workspace: varchar("workspace", { length: 50 }).notNull(),
  hasReportAccess: boolean("has_report_access").default(false),
  isActive: boolean("is_active").default(true),
  isOnline: boolean("is_online").default(false),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  emailIdx: index("users_email_idx").on(table.email),
  workspaceIdx: index("users_workspace_idx").on(table.workspace),
  workspaceCheck: check("users_workspace_check", sql`${table.workspace} IN ('administration', 'sales', 'teacher', 'analytics', 'marketing', 'management')`),
}));

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  isRead: boolean("is_read").default(false),
  relatedEntityType: varchar("related_entity_type", { length: 50 }),
  relatedEntityId: integer("related_entity_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: varchar("action", { length: 255 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: integer("entity_id"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** One-row, academy-wide targets controlled by the CEO. */
export const academyCompanySettings = pgTable("academy_company_settings", {
  id: serial("id").primaryKey(),
  targetRevenueMonthlyUzs: integer("target_revenue_monthly_uzs").notNull().default(0),
  targetNewLeadsMonthly: integer("target_new_leads_monthly").notNull().default(0),
  maxCacUzs: integer("max_cac_uzs").notNull().default(300000),
  maxCplUzs: integer("max_cpl_uzs").notNull().default(0),
  targetRoas: integer("target_roas").notNull().default(5),
  targetAttendancePercent: integer("target_attendance_percent").notNull().default(70),
  targetNps: integer("target_nps").notNull().default(50),
  salesCommissionPercent: integer("sales_commission_percent").notNull().default(0),
  groupMinFillPercent: integer("group_min_fill_percent").notNull().default(60),
  currentCashBalanceUzs: integer("current_cash_balance_uzs").notNull().default(0),
  salesPhoneVisibility: varchar("sales_phone_visibility", { length: 40 }).notNull().default("own_leads"),
  workdayStartHour: integer("workday_start_hour").notNull().default(8),
  workdayEndHour: integer("workday_end_hour").notNull().default(20),
  workdays: jsonb("workdays").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const academySchools = pgTable("academy_schools", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull(),
  address: text("address").notNull(),
  rooms: jsonb("rooms").$type<string[]>().notNull().default([]),
  timezone: varchar("timezone", { length: 80 }).notNull().default("Asia/Tashkent"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  codeUnique: uniqueIndex("academy_schools_code_unique").on(table.code),
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
  rentPerHourUzs: integer("rent_per_hour_uzs").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolIdx: index("academy_rooms_school_idx").on(table.schoolId),
  activeIdx: index("academy_rooms_active_idx").on(table.schoolId, table.isActive),
  capacityCheck: check("academy_rooms_capacity_check", sql`${table.capacity} > 0`),
}));

export const academyCourses = pgTable("academy_courses", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  ageCategory: varchar("age_category", { length: 100 }).notNull(),
  lessonCount: integer("lesson_count").notNull().default(0),
  lessonDurationMinutes: integer("lesson_duration_minutes").notNull().default(120),
  durationDays: integer("duration_days").notNull().default(0),
  description: text("description"),
  frequency: varchar("frequency", { length: 255 }),
  basePriceUzs: integer("base_price_uzs").notNull().default(0),
  discountedPriceUzs: integer("discounted_price_uzs").notNull().default(0),
  ltvTargetMinUzs: integer("ltv_target_min_uzs").notNull().default(0),
  ltvTargetMaxUzs: integer("ltv_target_max_uzs").notNull().default(0),
  program: jsonb("program").$type<AcademyCourseProgramLesson[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  slugUnique: uniqueIndex("academy_courses_slug_unique").on(table.slug),
}));

export const academyLeadSources = pgTable("academy_lead_sources", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 120 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  channel: varchar("channel", { length: 120 }),
  campaignName: varchar("campaign_name", { length: 255 }),
  costPerLeadUzs: integer("cost_per_lead_uzs").notNull().default(0),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  codeUnique: uniqueIndex("academy_lead_sources_code_unique").on(table.code),
}));

export const academyLeadStatuses = pgTable("academy_lead_statuses", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 80 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 40 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isPipeline: boolean("is_pipeline").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  codeUnique: uniqueIndex("academy_lead_statuses_code_unique").on(table.code),
}));

export const academyTeachers = pgTable("academy_teachers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  courseIds: jsonb("course_ids").$type<number[]>().notNull().default([]),
  schoolIds: jsonb("school_ids").$type<number[]>().notNull().default([]),
  availability: jsonb("availability").$type<AcademyScheduleItem[]>().notNull().default([]),
  schedule: jsonb("schedule").$type<AcademyScheduleItem[]>().notNull().default([]),
  ratePerLessonUzs: integer("rate_per_lesson_uzs").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const academyGroups = pgTable("academy_groups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  courseId: integer("course_id").references(() => academyCourses.id, { onDelete: "restrict" }).notNull(),
  schoolId: integer("school_id").references(() => academySchools.id, { onDelete: "restrict" }).notNull(),
  roomId: integer("room_id").references(() => academyRooms.id, { onDelete: "restrict" }).notNull(),
  teacherId: integer("teacher_id").references(() => academyTeachers.id, { onDelete: "set null" }),
  schedule: jsonb("schedule").$type<AcademyScheduleItem[]>().notNull().default([]),
  maxStudents: integer("max_students").notNull().default(12),
  status: varchar("status", { length: 50 }).notNull().default("open"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  courseIdx: index("academy_groups_course_idx").on(table.courseId),
  schoolIdx: index("academy_groups_school_idx").on(table.schoolId),
  roomIdx: index("academy_groups_room_idx").on(table.roomId),
  teacherIdx: index("academy_groups_teacher_idx").on(table.teacherId),
  capacityCheck: check("academy_groups_capacity_check", sql`${table.maxStudents} BETWEEN 1 AND 12`),
}));

export const academyLeads = pgTable("academy_leads", {
  id: serial("id").primaryKey(),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  messenger: varchar("messenger", { length: 120 }),
  studentName: varchar("student_name", { length: 255 }),
  studentAge: integer("student_age"),
  courseId: integer("course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  schoolId: integer("school_id").references(() => academySchools.id, { onDelete: "set null" }),
  sourceId: integer("source_id").references(() => academyLeadSources.id, { onDelete: "restrict" }).notNull(),
  advertisingCampaign: varchar("advertising_campaign", { length: 255 }),
  acquisitionCostUzs: integer("acquisition_cost_uzs").notNull().default(0),
  statusCode: varchar("status_code", { length: 80 }).notNull().default("new_request"),
  managerId: integer("manager_id").references(() => users.id, { onDelete: "set null" }),
  language: varchar("language", { length: 20 }).notNull().default("ru"),
  comment: text("comment"),
  firstContactAt: timestamp("first_contact_at"),
  firstContactChannel: varchar("first_contact_channel", { length: 80 }),
  firstContactResult: text("first_contact_result"),
  demoAt: timestamp("demo_at"),
  demoCourseId: integer("demo_course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  demoFormat: varchar("demo_format", { length: 50 }),
  demoLocation: text("demo_location"),
  demoAttended: boolean("demo_attended").notNull().default(false),
  demoResult: text("demo_result"),
  offerCourseId: integer("offer_course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  offerPriceUzs: integer("offer_price_uzs"),
  offerDiscount: varchar("offer_discount", { length: 120 }),
  offerAt: timestamp("offer_at"),
  enrolledGroupId: integer("enrolled_group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  expectedPaymentUzs: integer("expected_payment_uzs"),
  paymentMethod: varchar("payment_method", { length: 80 }),
  warmReason: text("warm_reason"),
  warmMovedAt: timestamp("warm_moved_at"),
  noMailing: boolean("no_mailing").notNull().default(false),
  referralCode: varchar("referral_code", { length: 80 }),
  referrerStudentId: integer("referrer_student_id"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  phoneIdx: index("academy_leads_phone_idx").on(table.phone),
  statusIdx: index("academy_leads_status_idx").on(table.statusCode),
  managerIdx: index("academy_leads_manager_idx").on(table.managerId),
  schoolIdx: index("academy_leads_school_idx").on(table.schoolId),
  sourceIdx: index("academy_leads_source_idx").on(table.sourceId),
}));

export const academyLeadStageHistory = pgTable("academy_lead_stage_history", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => academyLeads.id, { onDelete: "cascade" }).notNull(),
  fromStatusCode: varchar("from_status_code", { length: 80 }),
  toStatusCode: varchar("to_status_code", { length: 80 }).notNull(),
  enteredAt: timestamp("entered_at").defaultNow(),
  changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
  comment: text("comment"),
}, (table) => ({
  leadIdx: index("academy_lead_stage_history_lead_idx").on(table.leadId),
}));

export const academyLeadAssignmentHistory = pgTable("academy_lead_assignment_history", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => academyLeads.id, { onDelete: "cascade" }).notNull(),
  fromManagerId: integer("from_manager_id").references(() => users.id, { onDelete: "set null" }),
  toManagerId: integer("to_manager_id").references(() => users.id, { onDelete: "set null" }).notNull(),
  changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  leadIdx: index("academy_lead_assignment_history_lead_idx").on(table.leadId),
  toManagerIdx: index("academy_lead_assignment_history_to_manager_idx").on(table.toManagerId),
}));

export const academyStudents = pgTable("academy_students", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => academyLeads.id, { onDelete: "set null" }),
  groupId: integer("group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  messenger: varchar("messenger", { length: 120 }),
  studentName: varchar("student_name", { length: 255 }),
  studentAge: integer("student_age"),
  courseId: integer("course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  schoolId: integer("school_id").references(() => academySchools.id, { onDelete: "set null" }),
  managerId: integer("manager_id").references(() => users.id, { onDelete: "set null" }),
  status: varchar("status", { length: 50 }).notNull().default("studying"),
  exitReason: varchar("exit_reason", { length: 80 }),
  enrolledAt: timestamp("enrolled_at"),
  enrollmentDate: timestamp("enrollment_date"),
  balanceUzs: integer("balance_uzs").notNull().default(0),
  attendancePercent: integer("attendance_percent").notNull().default(0),
  progressPercent: integer("progress_percent").notNull().default(0),
  satisfactionAvg: integer("satisfaction_avg").notNull().default(0),
  parentFeedback: text("parent_feedback"),
  nextPaymentAt: timestamp("next_payment_at"),
  referralCode: varchar("referral_code", { length: 80 }).notNull(),
  referralLevel: varchar("referral_level", { length: 50 }).notNull().default("none"),
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  phoneIdx: index("academy_students_phone_idx").on(table.phone),
  groupIdx: index("academy_students_group_idx").on(table.groupId),
  leadIdx: index("academy_students_lead_idx").on(table.leadId),
  managerIdx: index("academy_students_manager_idx").on(table.managerId),
  schoolIdx: index("academy_students_school_idx").on(table.schoolId),
  statusIdx: index("academy_students_status_idx").on(table.status),
}));

export const academyStudentStatusHistory = pgTable("academy_student_status_history", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "cascade" }).notNull(),
  fromStatus: varchar("from_status", { length: 50 }),
  toStatus: varchar("to_status", { length: 50 }).notNull(),
  changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  studentIdx: index("academy_student_status_history_student_idx").on(table.studentId),
}));

export const academyLessons = pgTable("academy_lessons", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").references(() => academyGroups.id, { onDelete: "cascade" }).notNull(),
  courseId: integer("course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  schoolId: integer("school_id").references(() => academySchools.id, { onDelete: "set null" }),
  roomId: integer("room_id").references(() => academyRooms.id, { onDelete: "restrict" }).notNull(),
  teacherId: integer("teacher_id").references(() => academyTeachers.id, { onDelete: "set null" }),
  lessonNumber: integer("lesson_number").notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  materials: text("materials"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  status: varchar("status", { length: 50 }).notNull().default("scheduled"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  groupIdx: index("academy_lessons_group_idx").on(table.groupId),
  schoolIdx: index("academy_lessons_school_idx").on(table.schoolId),
  roomIdx: index("academy_lessons_room_idx").on(table.roomId),
  teacherIdx: index("academy_lessons_teacher_idx").on(table.teacherId),
}));

export const academyLessonStatusHistory = pgTable("academy_lesson_status_history", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").references(() => academyLessons.id, { onDelete: "cascade" }).notNull(),
  fromStatus: varchar("from_status", { length: 50 }),
  toStatus: varchar("to_status", { length: 50 }).notNull(),
  changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  lessonIdx: index("academy_lesson_status_history_lesson_idx").on(table.lessonId),
}));

export const academyAttendance = pgTable("academy_attendance", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").references(() => academyLessons.id, { onDelete: "cascade" }).notNull(),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "cascade" }).notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  projectUrl: text("project_url"),
  note: text("note"),
  markedBy: integer("marked_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  lessonStudentUnique: uniqueIndex("academy_attendance_lesson_student_unique").on(table.lessonId, table.studentId),
}));

export const academyPayments = pgTable("academy_payments", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => academyLeads.id, { onDelete: "set null" }),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "set null" }),
  groupId: integer("group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  amountUzs: integer("amount_uzs").notNull(),
  type: varchar("type", { length: 60 }).notNull().default("full"),
  method: varchar("method", { length: 60 }).notNull().default("transfer"),
  paidAt: timestamp("paid_at"),
  period: varchar("period", { length: 120 }),
  discount: varchar("discount", { length: 120 }).notNull().default("none"),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  dueAt: timestamp("due_at"),
  paidUntil: timestamp("paid_until"),
  comment: text("comment"),
  receiptUrl: text("receipt_url"),
  confirmedBy: integer("confirmed_by").references(() => users.id, { onDelete: "set null" }),
  refundedBy: integer("refunded_by").references(() => users.id, { onDelete: "set null" }),
  refundedAt: timestamp("refunded_at"),
  refundComment: text("refund_comment"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  studentIdx: index("academy_payments_student_idx").on(table.studentId),
  leadIdx: index("academy_payments_lead_idx").on(table.leadId),
  groupIdx: index("academy_payments_group_idx").on(table.groupId),
  statusIdx: index("academy_payments_status_idx").on(table.status),
}));

export const academyTasks = pgTable("academy_tasks", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  responsibleId: integer("responsible_id").references(() => users.id, { onDelete: "set null" }),
  deadlineAt: timestamp("deadline_at"),
  status: varchar("status", { length: 50 }).notNull().default("new"),
  entityType: varchar("entity_type", { length: 80 }),
  entityId: integer("entity_id"),
  completedAt: timestamp("completed_at"),
  escalatedAt: timestamp("escalated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  responsibleIdx: index("academy_tasks_responsible_idx").on(table.responsibleId),
  entityIdx: index("academy_tasks_entity_idx").on(table.entityType, table.entityId),
}));

export const academyCommunications = pgTable("academy_communications", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => academyLeads.id, { onDelete: "cascade" }),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "cascade" }),
  channel: varchar("channel", { length: 80 }).notNull(),
  result: text("result"),
  comment: text("comment"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  leadIdx: index("academy_communications_lead_idx").on(table.leadId),
  studentIdx: index("academy_communications_student_idx").on(table.studentId),
}));

export const academyStudentTransfers = pgTable("academy_student_transfers", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "cascade" }).notNull(),
  fromGroupId: integer("from_group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  toGroupId: integer("to_group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  studentIdx: index("academy_student_transfers_student_idx").on(table.studentId),
}));

export const academyLessonSurveys = pgTable("academy_lesson_surveys", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "cascade" }).notNull(),
  lessonId: integer("lesson_id").references(() => academyLessons.id, { onDelete: "cascade" }).notNull(),
  groupId: integer("group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  teacherId: integer("teacher_id").references(() => academyTeachers.id, { onDelete: "set null" }),
  courseId: integer("course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  score: integer("score").notNull(),
  liked: text("liked"),
  improve: text("improve"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  lessonIdx: index("academy_lesson_surveys_lesson_idx").on(table.lessonId),
}));

export const academyParentSurveys = pgTable("academy_parent_surveys", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "cascade" }).notNull(),
  groupId: integer("group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  courseId: integer("course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  progressAnswer: varchar("progress_answer", { length: 80 }),
  joyAnswer: varchar("joy_answer", { length: 80 }),
  continueAnswer: varchar("continue_answer", { length: 80 }),
  npsScore: integer("nps_score"),
  comment: text("comment"),
  period: varchar("period", { length: 40 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  studentIdx: index("academy_parent_surveys_student_idx").on(table.studentId),
}));

export const academyPortfolioProjects = pgTable("academy_portfolio_projects", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => academyStudents.id, { onDelete: "cascade" }).notNull(),
  lessonId: integer("lesson_id").references(() => academyLessons.id, { onDelete: "set null" }),
  groupId: integer("group_id").references(() => academyGroups.id, { onDelete: "set null" }),
  courseId: integer("course_id").references(() => academyCourses.id, { onDelete: "set null" }),
  title: varchar("title", { length: 255 }).notNull(),
  url: text("url"),
  fileUrl: text("file_url"),
  finalStatus: varchar("final_status", { length: 80 }).notNull().default("not_started"),
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  studentIdx: index("academy_portfolio_projects_student_idx").on(table.studentId),
}));

export const academyMarketingExpenses = pgTable("academy_marketing_expenses", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => academyLeadSources.id, { onDelete: "set null" }),
  channel: varchar("channel", { length: 120 }).notNull(),
  campaignName: varchar("campaign_name", { length: 255 }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  amountUzs: integer("amount_uzs").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  approvalComment: text("approval_comment"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  sourceIdx: index("academy_marketing_expenses_source_idx").on(table.sourceId),
}));

/** A frozen monthly result. It becomes a company expense only after payout. */
export const academyPayrollEntries = pgTable("academy_payroll_entries", {
  id: serial("id").primaryKey(),
  period: varchar("period", { length: 7 }).notNull(),
  entryType: varchar("entry_type", { length: 30 }).notNull(),
  employeeUserId: integer("employee_user_id").references(() => users.id, { onDelete: "set null" }),
  teacherId: integer("teacher_id").references(() => academyTeachers.id, { onDelete: "set null" }),
  employeeName: varchar("employee_name", { length: 255 }).notNull(),
  baseSalaryUzs: integer("base_salary_uzs").notNull().default(0),
  commissionPercent: integer("commission_percent").notNull().default(0),
  commissionBaseUzs: integer("commission_base_uzs").notNull().default(0),
  conductedLessons: integer("conducted_lessons").notNull().default(0),
  ratePerLessonUzs: integer("rate_per_lesson_uzs").notNull().default(0),
  amountUzs: integer("amount_uzs").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  paidBy: integer("paid_by").references(() => users.id, { onDelete: "set null" }),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  periodIdx: index("academy_payroll_entries_period_idx").on(table.period),
  userIdx: index("academy_payroll_entries_user_idx").on(table.employeeUserId),
  teacherIdx: index("academy_payroll_entries_teacher_idx").on(table.teacherId),
}));

/** Deduplication ledger for CEO escalations and cash-gap alerts. */
export const academyEscalationEvents = pgTable("academy_escalation_events", {
  id: serial("id").primaryKey(),
  eventKey: varchar("event_key", { length: 255 }).notNull(),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }),
  entityId: integer("entity_id"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  eventKeyUnique: uniqueIndex("academy_escalation_events_key_unique").on(table.eventKey),
  eventTypeIdx: index("academy_escalation_events_type_idx").on(table.eventType),
}));

export const academyReferralRewards = pgTable("academy_referral_rewards", {
  id: serial("id").primaryKey(),
  referrerStudentId: integer("referrer_student_id").references(() => academyStudents.id, { onDelete: "cascade" }).notNull(),
  referredLeadId: integer("referred_lead_id").references(() => academyLeads.id, { onDelete: "set null" }),
  referredStudentId: integer("referred_student_id").references(() => academyStudents.id, { onDelete: "set null" }),
  rewardType: varchar("reward_type", { length: 80 }).notNull(),
  rewardValue: varchar("reward_value", { length: 120 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  appliedAt: timestamp("applied_at"),
}, (table) => ({
  referrerIdx: index("academy_referral_rewards_referrer_idx").on(table.referrerStudentId),
  referredLeadIdx: index("academy_referral_rewards_referred_lead_idx").on(table.referredLeadId),
}));

export const academyIntegrationLogs = pgTable("academy_integration_logs", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 120 }).notNull(),
  direction: varchar("direction", { length: 40 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  payload: jsonb("payload"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  providerIdx: index("academy_integration_logs_provider_idx").on(table.provider),
}));

export const instagramAccounts = pgTable("instagram_accounts", {
  id: serial("id").primaryKey(),
  igUserId: varchar("ig_user_id", { length: 80 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  profilePictureUrl: text("profile_picture_url"),
  accessTokenEncrypted: text("access_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at"),
  sourceId: integer("source_id").references(() => academyLeadSources.id, { onDelete: "restrict" }).notNull(),
  status: varchar("status", { length: 40 }).notNull().default("connected"),
  lastWebhookAt: timestamp("last_webhook_at"),
  lastError: text("last_error"),
  connectedBy: integer("connected_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  igUserUnique: uniqueIndex("instagram_accounts_ig_user_unique").on(table.igUserId),
  sourceUnique: uniqueIndex("instagram_accounts_source_unique").on(table.sourceId),
  statusIdx: index("instagram_accounts_status_idx").on(table.status),
}));

export const instagramConversations = pgTable("instagram_conversations", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => instagramAccounts.id, { onDelete: "cascade" }).notNull(),
  leadId: integer("lead_id").references(() => academyLeads.id, { onDelete: "set null" }),
  participantIgsid: varchar("participant_igsid", { length: 80 }).notNull(),
  participantUsername: varchar("participant_username", { length: 255 }),
  participantName: varchar("participant_name", { length: 255 }),
  participantProfilePictureUrl: text("participant_profile_picture_url"),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at"),
  lastInboundAt: timestamp("last_inbound_at"),
  lastOutboundAt: timestamp("last_outbound_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  participantUnique: uniqueIndex("instagram_conversations_account_participant_unique").on(
    table.accountId,
    table.participantIgsid,
  ),
  accountIdx: index("instagram_conversations_account_idx").on(table.accountId),
  leadIdx: index("instagram_conversations_lead_idx").on(table.leadId),
  lastMessageIdx: index("instagram_conversations_last_message_idx").on(table.lastMessageAt),
}));

export const instagramMessages = pgTable("instagram_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => instagramConversations.id, { onDelete: "cascade" }).notNull(),
  externalMessageId: varchar("external_message_id", { length: 255 }),
  direction: varchar("direction", { length: 20 }).notNull(),
  senderIgsid: varchar("sender_igsid", { length: 80 }).notNull(),
  recipientIgsid: varchar("recipient_igsid", { length: 80 }).notNull(),
  content: text("content").notNull(),
  messageType: varchar("message_type", { length: 50 }).notNull().default("text"),
  status: varchar("status", { length: 40 }).notNull().default("received"),
  sentBy: integer("sent_by").references(() => users.id, { onDelete: "set null" }),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  externalMessageUnique: uniqueIndex("instagram_messages_external_message_unique").on(table.externalMessageId),
  conversationIdx: index("instagram_messages_conversation_idx").on(table.conversationId),
  createdIdx: index("instagram_messages_created_idx").on(table.createdAt),
}));

export const academyNotificationOutbox = pgTable("academy_notification_outbox", {
  id: serial("id").primaryKey(),
  channel: varchar("channel", { length: 80 }).notNull(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  message: text("message").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  entityType: varchar("entity_type", { length: 80 }),
  entityId: integer("entity_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  statusIdx: index("academy_notification_outbox_status_idx").on(table.status),
}));

// Internal staff chat.
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  receiverId: integer("receiver_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
// Insert schemas
export const insertUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  dateOfBirth: z.coerce.date().optional().nullable(),
  position: z.string().optional(),
  baseSalaryUzs: z.number().int().min(0).default(0),
  workspace: z.enum(ACADEMY_WORKSPACES),
  hasReportAccess: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const insertUserSchemaForAPI = insertUserSchema.omit({ password: true });

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyCompanySettingsSchema = createInsertSchema(academyCompanySettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademySchoolSchema = createInsertSchema(academySchools).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyRoomSchema = createInsertSchema(academyRooms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyCourseSchema = createInsertSchema(academyCourses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyLeadSourceSchema = createInsertSchema(academyLeadSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyLeadStatusSchema = createInsertSchema(academyLeadStatuses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyTeacherSchema = createInsertSchema(academyTeachers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyGroupSchema = createInsertSchema(academyGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyLeadSchema = createInsertSchema(academyLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyLeadStageHistorySchema = createInsertSchema(academyLeadStageHistory).omit({
  id: true,
});

export const insertAcademyLeadAssignmentHistorySchema = createInsertSchema(academyLeadAssignmentHistory).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyStudentSchema = createInsertSchema(academyStudents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyStudentStatusHistorySchema = createInsertSchema(academyStudentStatusHistory).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyLessonSchema = createInsertSchema(academyLessons).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyLessonStatusHistorySchema = createInsertSchema(academyLessonStatusHistory).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyAttendanceSchema = createInsertSchema(academyAttendance).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyPaymentSchema = createInsertSchema(academyPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyTaskSchema = createInsertSchema(academyTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyCommunicationSchema = createInsertSchema(academyCommunications).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyStudentTransferSchema = createInsertSchema(academyStudentTransfers).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyLessonSurveySchema = createInsertSchema(academyLessonSurveys).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyParentSurveySchema = createInsertSchema(academyParentSurveys).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyPortfolioProjectSchema = createInsertSchema(academyPortfolioProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyMarketingExpenseSchema = createInsertSchema(academyMarketingExpenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyPayrollEntrySchema = createInsertSchema(academyPayrollEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyEscalationEventSchema = createInsertSchema(academyEscalationEvents).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyReferralRewardSchema = createInsertSchema(academyReferralRewards).omit({
  id: true,
  createdAt: true,
});

export const insertAcademyIntegrationLogSchema = createInsertSchema(academyIntegrationLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInstagramAccountSchema = createInsertSchema(instagramAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInstagramConversationSchema = createInsertSchema(instagramConversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInstagramMessageSchema = createInsertSchema(instagramMessages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAcademyNotificationOutboxSchema = createInsertSchema(academyNotificationOutbox).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  isRead: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AcademyCompanySettings = typeof academyCompanySettings.$inferSelect;
export type InsertAcademyCompanySettings = z.infer<typeof insertAcademyCompanySettingsSchema>;
export type AcademySchool = typeof academySchools.$inferSelect;
export type InsertAcademySchool = z.infer<typeof insertAcademySchoolSchema>;
export type AcademyRoom = typeof academyRooms.$inferSelect;
export type InsertAcademyRoom = z.infer<typeof insertAcademyRoomSchema>;
export type AcademyCourse = typeof academyCourses.$inferSelect;
export type InsertAcademyCourse = z.infer<typeof insertAcademyCourseSchema>;
export type AcademyLeadSource = typeof academyLeadSources.$inferSelect;
export type InsertAcademyLeadSource = z.infer<typeof insertAcademyLeadSourceSchema>;
export type AcademyLeadStatus = typeof academyLeadStatuses.$inferSelect;
export type InsertAcademyLeadStatus = z.infer<typeof insertAcademyLeadStatusSchema>;
export type AcademyTeacher = typeof academyTeachers.$inferSelect;
export type InsertAcademyTeacher = z.infer<typeof insertAcademyTeacherSchema>;
export type AcademyGroup = typeof academyGroups.$inferSelect;
export type InsertAcademyGroup = z.infer<typeof insertAcademyGroupSchema>;
export type AcademyLead = typeof academyLeads.$inferSelect;
export type InsertAcademyLead = z.infer<typeof insertAcademyLeadSchema>;
export type AcademyLeadStageHistory = typeof academyLeadStageHistory.$inferSelect;
export type InsertAcademyLeadStageHistory = z.infer<typeof insertAcademyLeadStageHistorySchema>;
export type AcademyLeadAssignmentHistory = typeof academyLeadAssignmentHistory.$inferSelect;
export type InsertAcademyLeadAssignmentHistory = z.infer<typeof insertAcademyLeadAssignmentHistorySchema>;
export type AcademyStudent = typeof academyStudents.$inferSelect;
export type InsertAcademyStudent = z.infer<typeof insertAcademyStudentSchema>;
export type AcademyStudentStatusHistory = typeof academyStudentStatusHistory.$inferSelect;
export type InsertAcademyStudentStatusHistory = z.infer<typeof insertAcademyStudentStatusHistorySchema>;
export type AcademyLesson = typeof academyLessons.$inferSelect;
export type InsertAcademyLesson = z.infer<typeof insertAcademyLessonSchema>;
export type AcademyLessonStatusHistory = typeof academyLessonStatusHistory.$inferSelect;
export type InsertAcademyLessonStatusHistory = z.infer<typeof insertAcademyLessonStatusHistorySchema>;
export type AcademyAttendance = typeof academyAttendance.$inferSelect;
export type InsertAcademyAttendance = z.infer<typeof insertAcademyAttendanceSchema>;
export type AcademyPayrollEntry = typeof academyPayrollEntries.$inferSelect;
export type InsertAcademyPayrollEntry = z.infer<typeof insertAcademyPayrollEntrySchema>;
export type AcademyEscalationEvent = typeof academyEscalationEvents.$inferSelect;
export type InsertAcademyEscalationEvent = z.infer<typeof insertAcademyEscalationEventSchema>;
export type AcademyPayment = typeof academyPayments.$inferSelect;
export type InsertAcademyPayment = z.infer<typeof insertAcademyPaymentSchema>;
export type AcademyTask = typeof academyTasks.$inferSelect;
export type InsertAcademyTask = z.infer<typeof insertAcademyTaskSchema>;
export type AcademyCommunication = typeof academyCommunications.$inferSelect;
export type InsertAcademyCommunication = z.infer<typeof insertAcademyCommunicationSchema>;
export type AcademyStudentTransfer = typeof academyStudentTransfers.$inferSelect;
export type InsertAcademyStudentTransfer = z.infer<typeof insertAcademyStudentTransferSchema>;
export type AcademyLessonSurvey = typeof academyLessonSurveys.$inferSelect;
export type InsertAcademyLessonSurvey = z.infer<typeof insertAcademyLessonSurveySchema>;
export type AcademyParentSurvey = typeof academyParentSurveys.$inferSelect;
export type InsertAcademyParentSurvey = z.infer<typeof insertAcademyParentSurveySchema>;
export type AcademyPortfolioProject = typeof academyPortfolioProjects.$inferSelect;
export type InsertAcademyPortfolioProject = z.infer<typeof insertAcademyPortfolioProjectSchema>;
export type AcademyMarketingExpense = typeof academyMarketingExpenses.$inferSelect;
export type InsertAcademyMarketingExpense = z.infer<typeof insertAcademyMarketingExpenseSchema>;
export type AcademyReferralReward = typeof academyReferralRewards.$inferSelect;
export type InsertAcademyReferralReward = z.infer<typeof insertAcademyReferralRewardSchema>;
export type AcademyIntegrationLog = typeof academyIntegrationLogs.$inferSelect;
export type InsertAcademyIntegrationLog = z.infer<typeof insertAcademyIntegrationLogSchema>;
export type InstagramAccount = typeof instagramAccounts.$inferSelect;
export type InsertInstagramAccount = z.infer<typeof insertInstagramAccountSchema>;
export type InstagramConversation = typeof instagramConversations.$inferSelect;
export type InsertInstagramConversation = z.infer<typeof insertInstagramConversationSchema>;
export type InstagramMessage = typeof instagramMessages.$inferSelect;
export type InsertInstagramMessage = z.infer<typeof insertInstagramMessageSchema>;
export type AcademyNotificationOutbox = typeof academyNotificationOutbox.$inferSelect;
export type InsertAcademyNotificationOutbox = z.infer<typeof insertAcademyNotificationOutboxSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// ---------------------------------------------------------------------------
// Management board (Kanban task management).
// One shared board ships today; the `boards` table and `boardId` foreign keys
// leave room to add more boards, per-board membership and access rules later
// without breaking existing tasks or data.
// ---------------------------------------------------------------------------

export const BOARD_TASK_STATUSES = ["backlog", "todo", "in_progress", "done", "accepted"] as const;
export type BoardTaskStatus = (typeof BOARD_TASK_STATUSES)[number];

export const BOARD_TASK_PRIORITIES = ["urgent", "normal", "low"] as const;
export type BoardTaskPriority = (typeof BOARD_TASK_PRIORITIES)[number];

export const boards = pgTable("boards", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  defaultIdx: index("boards_default_idx").on(table.isDefault),
}));

export const boardTasks = pgTable("board_tasks", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id").references(() => boards.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("backlog"),
  priority: varchar("priority", { length: 10 }).notNull().default("normal"),
  position: integer("position").notNull().default(0),
  creatorId: integer("creator_id").references(() => users.id, { onDelete: "set null" }),
  assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
  dueAt: timestamp("due_at"),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: integer("accepted_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  boardStatusIdx: index("board_tasks_board_status_idx").on(table.boardId, table.status),
  assigneeIdx: index("board_tasks_assignee_idx").on(table.assigneeId),
  creatorIdx: index("board_tasks_creator_idx").on(table.creatorId),
  statusCheck: check("board_tasks_status_check", sql`${table.status} IN ('backlog', 'todo', 'in_progress', 'done', 'accepted')`),
  priorityCheck: check("board_tasks_priority_check", sql`${table.priority} IN ('urgent', 'normal', 'low')`),
}));

export const boardTaskComments = pgTable("board_task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => boardTasks.id, { onDelete: "cascade" }).notNull(),
  authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  taskIdx: index("board_task_comments_task_idx").on(table.taskId),
}));

export const boardTaskChecklistItems = pgTable("board_task_checklist_items", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => boardTasks.id, { onDelete: "cascade" }).notNull(),
  content: varchar("content", { length: 500 }).notNull(),
  isDone: boolean("is_done").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  taskIdx: index("board_task_checklist_items_task_idx").on(table.taskId),
}));

export const boardTaskAttachments = pgTable("board_task_attachments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => boardTasks.id, { onDelete: "cascade" }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }),
  size: integer("size").notNull().default(0),
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  taskIdx: index("board_task_attachments_task_idx").on(table.taskId),
}));

export const boardTaskActivity = pgTable("board_task_activity", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => boardTasks.id, { onDelete: "cascade" }).notNull(),
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
  type: varchar("type", { length: 40 }).notNull(),
  fromValue: varchar("from_value", { length: 120 }),
  toValue: varchar("to_value", { length: 120 }),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  taskIdx: index("board_task_activity_task_idx").on(table.taskId),
}));

export const insertBoardSchema = createInsertSchema(boards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBoardTaskSchema = createInsertSchema(boardTasks).omit({
  id: true,
  acceptedAt: true,
  acceptedBy: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBoardTaskCommentSchema = createInsertSchema(boardTaskComments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBoardTaskChecklistItemSchema = createInsertSchema(boardTaskChecklistItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBoardTaskAttachmentSchema = createInsertSchema(boardTaskAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertBoardTaskActivitySchema = createInsertSchema(boardTaskActivity).omit({
  id: true,
  createdAt: true,
});

export type Board = typeof boards.$inferSelect;
export type InsertBoard = z.infer<typeof insertBoardSchema>;
export type BoardTask = typeof boardTasks.$inferSelect;
export type InsertBoardTask = z.infer<typeof insertBoardTaskSchema>;
export type BoardTaskComment = typeof boardTaskComments.$inferSelect;
export type InsertBoardTaskComment = z.infer<typeof insertBoardTaskCommentSchema>;
export type BoardTaskChecklistItem = typeof boardTaskChecklistItems.$inferSelect;
export type InsertBoardTaskChecklistItem = z.infer<typeof insertBoardTaskChecklistItemSchema>;
export type BoardTaskAttachment = typeof boardTaskAttachments.$inferSelect;
export type InsertBoardTaskAttachment = z.infer<typeof insertBoardTaskAttachmentSchema>;
export type BoardTaskActivity = typeof boardTaskActivity.$inferSelect;
export type InsertBoardTaskActivity = z.infer<typeof insertBoardTaskActivitySchema>;
