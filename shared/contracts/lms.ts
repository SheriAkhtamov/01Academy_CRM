import { z } from "zod";

export const lmsIdSchema = z.coerce.number().int().positive();
export const lmsCourseQuerySchema = z.object({ enrollmentId: lmsIdSchema.optional() });
export type LmsEnrollmentPeriod = { enrolledAt: string; endedAt: string | null };
export const lmsPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: lmsIdSchema.optional(),
});
export const lmsAnalyticsSchema = z.object({
  days: z.coerce
    .number()
    .refine((value) => value === 7 || value === 30, "lmsInvalidRequest")
    .default(7),
  runId: lmsIdSchema.optional(),
});
export type LmsAnalyticsInput = z.infer<typeof lmsAnalyticsSchema>;
export type LmsAnalyticsRatioDto = {
  numerator: number;
  denominator: number;
  percent: number | null;
};
export type LmsAnalyticsDto = {
  periodFrom: string;
  periodTo: string;
  runId: number | null;
  activatedAccounts: LmsAnalyticsRatioDto;
  learningActive: LmsAnalyticsRatioDto;
  onTimeSubmissions: LmsAnalyticsRatioDto;
  awaitingReview: LmsAnalyticsRatioDto;
  reviewLatency: { averageHours: number | null; samples: number };
  openHelp: LmsAnalyticsRatioDto;
  responseLatency: { averageHours: number | null; samples: number };
  absences: LmsAnalyticsRatioDto;
  completedMakeup: LmsAnalyticsRatioDto;
};
export type LmsTeacherSummaryRunDto = {
  runId: number;
  groupName: string;
  courseId: number;
  canManageSchedule: boolean;
  pendingReviews: number;
  openHelp: number;
  unpreparedLessons: Array<{
    lessonId: number;
    topic: string;
    scheduledAt: string;
    unitId: number | null;
  }>;
};
export type LmsTeacherSummaryDto = {
  pendingReviews: number;
  openHelp: number;
  unpreparedLessons: number;
  runs: LmsTeacherSummaryRunDto[];
};
export const lmsHttpsSchema = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" && !parsed.username && !parsed.password
      );
    } catch {
      return false;
    }
  }, "lmsInvalidLink");
const content = z
  .string()
  .trim()
  .max(100000)
  .refine(
    (value) =>
      !/<\/?[a-z][^>]*>/i.test(
        value.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, ""),
      ),
    "lmsUnsafeContent",
  );
const files = z.array(lmsIdSchema).max(5).default([]);
export const lmsAnswerSchema = z.object({
  text: content.default(""),
  links: z.array(lmsHttpsSchema).max(10).default([]),
  fileIds: files,
});
export const lmsDraftSchema = lmsAnswerSchema.extend({
  version: z.number().int().nonnegative(),
});
export const lmsSubmitSchema = lmsAnswerSchema.extend({
  assignmentVersionId: lmsIdSchema,
  draftVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(128),
});
export const lmsVersionSchema = z.object({
  version: z.number().int().positive(),
});
export const lmsReviewSchema = lmsVersionSchema
  .extend({
    idempotencyKey: z.string().min(8).max(128).optional(),
    decision: z.enum(["accepted", "revision_required"]),
    comment: content.default(""),
    score: z.number().min(0).optional(),
    criterionScores: z.record(z.number().min(0)).default({}),
    reason: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (value) =>
      value.decision !== "revision_required" || value.comment.length > 0,
    "lmsReviewCommentRequired",
  );
export const lmsAssignmentSchema = z
  .object({
    copySourceAssignmentId: lmsIdSchema.optional(),
    copySourceAssignmentVersionId: lmsIdSchema.optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
    runId: lmsIdSchema,
    unitId: lmsIdSchema.nullable().optional(),
    title: z.string().trim().min(1).max(255),
    body: content,
    required: z.boolean().default(true),
    opensAt: z.string().datetime(),
    dueAt: z.string().datetime().nullable(),
    closesAt: z.string().datetime().nullable().default(null),
    gradingMode: z.enum(["acceptance", "points"]).default("acceptance"),
    maxScore: z.number().positive().nullable().default(null),
    criteria: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          title: z.string().trim().min(1).max(255),
          weight: z.number().positive().max(100),
        }),
      )
      .max(20)
      .default([]),
    allowedAnswers: z
      .array(z.enum(["text", "links", "files"]))
      .min(1)
      .default(["text", "links", "files"]),
    recipientEnrollmentIds: z.array(lmsIdSchema).min(1).max(500),
    fileIds: files,
  })
  .refine(
    (value) =>
      Boolean(value.copySourceAssignmentId) ===
      Boolean(value.copySourceAssignmentVersionId),
    "lmsInvalidRequest",
  )
  .refine(
    (value) => value.gradingMode !== "points" || value.maxScore !== null,
    "lmsMaxScoreRequired",
  )
  .refine(
    (value) =>
      !value.criteria.length ||
      Math.abs(
        value.criteria.reduce((sum, item) => sum + item.weight, 0) - 100,
      ) < 0.0001,
    "lmsCriteriaWeightInvalid",
  )
  .refine(
    (value) => !value.dueAt || new Date(value.dueAt) >= new Date(value.opensAt),
    "lmsDatesInvalid",
  )
  .refine(
    (value) =>
      !value.closesAt || +new Date(value.closesAt) >= +new Date(value.opensAt),
    "lmsDatesInvalid",
  )
  .refine(
    (value) =>
      new Set(value.criteria.map((item) => item.id)).size ===
      value.criteria.length,
    "lmsCriteriaWeightInvalid",
  );
export const lmsMaterialSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  runId: lmsIdSchema,
  unitId: lmsIdSchema.nullable().optional(),
  title: z.string().trim().min(1).max(255),
  body: content,
  category: z.enum(["lesson", "practice", "repeat"]).default("lesson"),
  links: z.array(lmsHttpsSchema).max(20).default([]),
  fileIds: files,
  videoUrl: lmsHttpsSchema
    .refine((value) => {
      try {
        return [
          "youtube.com",
          "www.youtube.com",
          "youtu.be",
          "vimeo.com",
          "www.vimeo.com",
          "player.vimeo.com",
        ].includes(new URL(value).hostname.toLowerCase());
      } catch {
        return false;
      }
    }, "lmsInvalidLink")
    .nullable()
    .default(null),
  durationMinutes: z.number().int().min(1).max(1440).nullable().default(null),
  publishAt: z.string().datetime().nullable().default(null),
  recipientEnrollmentIds: z.array(lmsIdSchema).max(500).optional(),
});
export const lmsRunSchema = z
  .object({
    groupId: lmsIdSchema,
    courseVersionId: lmsIdSchema.optional(),
    format: z.enum(["offline", "online"]).default("offline"),
    meetingUrl: lmsHttpsSchema.nullable().default(null),
  })
  .refine(
    (value) => value.format !== "online" || !!value.meetingUrl,
    "lmsMeetingLinkRequired",
  );
export const lmsQuizQuestionSchema = z
  .object({
    id: z.string().min(1).max(80),
    text: content,
    type: z.enum(["single", "multiple", "boolean"]),
    weight: z.number().positive().max(1000),
    options: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          text: z.string().trim().min(1).max(2000),
        }),
      )
      .min(2)
      .max(20),
    correctOptionIds: z.array(z.string().min(1)).min(1),
    explanation: content.default(""),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.options.map((option) => option.id));
    if (
      ids.size !== value.options.length ||
      value.correctOptionIds.some((id) => !ids.has(id)) ||
      new Set(value.correctOptionIds).size !== value.correctOptionIds.length ||
      (value.type !== "multiple" && value.correctOptionIds.length !== 1) ||
      (value.type === "boolean" && value.options.length !== 2)
    )
      context.addIssue({ code: "custom", message: "lmsQuizOptionsInvalid" });
  });
export const lmsQuizSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(128).optional(),
    runId: lmsIdSchema,
    unitId: lmsIdSchema.nullable().optional(),
    title: z.string().trim().min(1).max(255),
    instructions: content.default(""),
    required: z.boolean().default(true),
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime().nullable().default(null),
    passPercent: z.number().min(0).max(100).default(70),
    maxAttempts: z.number().int().min(1).max(20).default(3),
    timerSeconds: z.number().int().min(30).max(86400).nullable().default(null),
    disclosure: z.enum(["practice", "closed", "exhausted"]).default("practice"),
    shuffleQuestions: z.boolean().default(false),
    shuffleOptions: z.boolean().default(false),
    questions: z.array(lmsQuizQuestionSchema).min(1).max(100),
    recipientEnrollmentIds: z.array(lmsIdSchema).min(1).max(500),
  })
  .refine(
    (value) =>
      new Set(value.questions.map((question) => question.id)).size ===
      value.questions.length,
    "lmsQuizQuestionsInvalid",
  )
  .refine(
    (value) =>
      !value.closesAt || +new Date(value.closesAt) > +new Date(value.opensAt),
    "lmsDatesInvalid",
  );
export const lmsQuizAnswerSchema = z.object({
  version: z.number().int().positive(),
  optionIds: z.array(z.string().min(1).max(80)).max(20),
});
export const lmsRecipientUpdateSchema = lmsVersionSchema.extend({
  dueAt: z.string().datetime().nullable().optional(),
  status: z.enum(["assigned", "excused", "cancelled"]).optional(),
  reason: z.string().trim().min(1).max(2000),
});
export const lmsThreadSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  shareWithFamily: z.boolean().default(false),
  runId: lmsIdSchema,
  unitId: lmsIdSchema.optional(),
  recipientId: lmsIdSchema.optional(),
  quizAttemptId: lmsIdSchema.optional(),
  stepUrl: lmsHttpsSchema.optional(),
  title: z.string().trim().min(1).max(255),
  body: content.refine((value) => value.length > 0, "lmsContentRequired"),
  audience: z
    .enum(["student_teacher", "representative_teacher"])
    .default("student_teacher"),
  fileIds: z.array(lmsIdSchema).max(3).default([]),
});
export const lmsCommentSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  shareWithFamily: z.boolean().optional(),
  audienceAccountId: lmsIdSchema.optional(),
  body: content.refine((value) => value.length > 0, "lmsContentRequired"),
  audience: z
    .enum([
      "student_teacher",
      "family_teacher",
      "staff",
      "representative_teacher",
    ])
    .default("family_teacher"),
  fileIds: z.array(lmsIdSchema).max(3).default([]),
});
export const lmsAnnouncementSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  runId: lmsIdSchema,
  title: z.string().trim().min(1).max(255),
  body: content.refine((value) => value.length > 0, "lmsContentRequired"),
  audience: z.enum(["students", "representatives", "all"]).default("all"),
  publishAt: z.string().datetime(),
  pinnedUntil: z.string().datetime().nullable().default(null),
  fileIds: files,
});
export const lmsReportSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(128).optional(),
    bestProjectIds: z.array(lmsIdSchema).max(6).default([]),
    runId: lmsIdSchema,
    studentId: lmsIdSchema,
    periodFrom: z.string().datetime(),
    periodTo: z.string().datetime(),
    comment: content.refine((value) => value.length > 0, "lmsContentRequired"),
    nextSteps: content.refine(
      (value) => value.length > 0,
      "lmsContentRequired",
    ),
  })
  .refine(
    (value) => new Date(value.periodTo) > new Date(value.periodFrom),
    "lmsDatesInvalid",
  );
export const lmsReasonSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export const lmsExtraAttemptSchema = lmsReasonSchema.extend({
  idempotencyKey: z.string().min(8).max(128),
});
export const lmsAchievementSchema = z.object({
  runId: lmsIdSchema,
  studentId: lmsIdSchema,
  title: z.string().trim().min(1).max(255),
  reason: z.string().trim().min(1).max(2000),
  eventKey: z.string().min(8).max(128),
});
export const lmsScheduleQuerySchema = z
  .object({ from: z.string().datetime(), to: z.string().datetime() })
  .refine((value) => {
    const range = +new Date(value.to) - +new Date(value.from);
    return range > 0 && range <= 90 * 86400000;
  }, "lmsScheduleRangeInvalid");
export type LmsPage<T> = {
  items: T[];
  nextCursor: number | null;
  hasMore: boolean;
};
export type LmsListOptions = { limit: number; cursor?: number };
export type LmsProgressMetric = {
  completed: number;
  total: number;
  percent: number | null;
};
export type LmsCourseDto = {
  nextLesson?: LmsScheduleDto | null;
  currentUnit?: { id: number; title: string } | null;
  calendarUnitId?: number | null;
  id: number;
  runId: number;
  enrollmentId: number;
  groupId: number;
  groupName: string;
  courseName: string;
  teacherName: string | null;
  status: string;
  enrolledAt: string;
  endedAt: string | null;
  accessUntil: string | null;
  progress: LmsProgressMetric;
};
export type LmsMaterialDto = {
  enrollmentId?: number;
  lessonAt?: string | null;
  authorName?: string | null;
  durationMinutes?: number | null;
  videoUrl?: string | null;
  id: number;
  publicationId: number;
  materialVersionId: number;
  runId: number;
  unitId: number | null;
  title: string;
  body: string;
  category: string;
  links: string[];
  fileIds: number[];
  publishedAt: string;
  read: boolean;
};
export type LmsUnitDto = {
  status?: "soon" | "available" | "studied";
  openAt?: string | null;
  sectionTitle?: string | null;
  id: number;
  title: string;
  position: number;
  required: boolean;
  materials: LmsMaterialDto[];
};
export type LmsCourseDetailDto = LmsCourseDto & {
  units: LmsUnitDto[];
  materials: LmsMaterialDto[];
};
export type LmsAssignmentStatus =
  | "assigned"
  | "submitted"
  | "revision_required"
  | "accepted"
  | "excused"
  | "cancelled";
export type LmsAssignmentDto = {
  enrollmentId?: number;
  id: number;
  recipientId: number;
  assignmentVersionId: number;
  runId: number;
  unitId: number | null;
  title: string;
  courseName: string;
  groupName: string;
  opensAt: string;
  dueAt: string | null;
  closesAt: string | null;
  required: boolean;
  status: LmsAssignmentStatus;
  overdue: boolean;
  version: number;
};
export type LmsDraftDto = {
  version: number;
  text: string;
  links: string[];
  fileIds: number[];
  savedAt: string | null;
};
export type LmsSubmissionDto = {
  assignmentVersionId?: number;
  title?: string;
  criteria?: { id: string; title: string; weight: number }[];
  maxScore?: number | null;
  gradingMode?: "acceptance" | "points";
  reviewHistory?: LmsReviewDto[];
  id: number;
  attemptNumber: number;
  text: string;
  links: string[];
  fileIds: number[];
  submittedAt: string;
  late: boolean;
  withdrawnAt: string | null;
  review: LmsReviewDto | null;
};
export type LmsReviewDto = {
  reason?: string | null;
  id: number;
  decision: "accepted" | "revision_required";
  comment: string;
  score: number | null;
  criterionScores: Record<string, number>;
  reviewerName: string;
  createdAt: string;
};
export type LmsCommentDto = {
  authorAccountId?: number | null;
  audienceAccountId?: number | null;
  id: number;
  body: string;
  authorName: string;
  audience: string;
  createdAt: string;
  fileIds: number[];
};
export type LmsAssignmentDetailDto = LmsAssignmentDto & {
  canWithdraw?: boolean;
  reviewStarted?: boolean;
  body: string;
  gradingMode: "acceptance" | "points";
  maxScore: number | null;
  criteria: { id: string; title: string; weight: number }[];
  allowedAnswers: string[];
  fileIds: number[];
  draft: LmsDraftDto;
  submissions: LmsSubmissionDto[];
  comments: LmsCommentDto[];
};
export type LmsScheduleDto = {
  rescheduled?: boolean;
  previousScheduledAt?: string | null;
  unitId?: number | null;
  materials?: LmsMaterialDto[];
  assignments?: {
    recipientId: number;
    title: string;
    status: LmsAssignmentStatus;
  }[];
  id: number;
  lessonId: number;
  runId: number;
  courseName: string;
  groupName: string;
  topic: string;
  scheduledAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  teacherName: string | null;
  schoolName: string | null;
  roomName: string | null;
  format: "offline" | "online";
  meetingUrl: string | null;
  attendance: "present" | "absent" | null;
  updatedAt: string | null;
};
export type LmsProgressDto = {
  attendance: LmsProgressMetric & { unmarked: number };
  assignments: LmsProgressMetric;
  quizzes: LmsProgressMetric;
  materials: LmsProgressMetric;
};
export type LmsQuizDto = {
  enrollmentId?: number;
  id: number;
  recipientId: number;
  runId: number;
  title: string;
  instructions: string;
  required: boolean;
  opensAt: string;
  closesAt: string | null;
  maxAttempts: number;
  passPercent: number;
  timerSeconds: number | null;
  attemptsUsed: number;
  activeAttemptId: number | null;
  latestFinishedAttemptId: number | null;
  bestPercent: number | null;
  passed: boolean;
  status: string;
};
export type LmsQuizQuestionDto = Omit<
  z.infer<typeof lmsQuizQuestionSchema>,
  "correctOptionIds" | "explanation"
>;
export type LmsQuizAttemptDto = {
  relatedMaterials?: { runId: number; publicationId: number; title: string; enrollmentId?: number }[];
  id: number;
  recipientId: number;
  quizVersionId: number;
  attemptNumber: number;
  version: number;
  state: "active" | "finished";
  startedAt: string;
  deadlineAt: string | null;
  serverTime: string;
  finishedAt: string | null;
  questions: LmsQuizQuestionDto[];
  answers: Record<string, string[]>;
  score: number | null;
  totalScore: number | null;
  percent: number | null;
  passed: boolean | null;
  disclosure:
    | { questionId: string; correctOptionIds: string[]; explanation: string }[]
    | null;
};
export type LmsMakeupDto = {
  quizRecipientId: number | null;
  id: number;
  lessonId: number;
  runId: number;
  topic: string;
  scheduledAt: string;
  status: "needed" | "in_progress" | "completed" | "not_required";
  dueAt: string | null;
  materials: LmsMaterialDto[];
  recipientId: number | null;
};
export type LmsAchievementDto = {
  id: number;
  runId: number;
  title: string;
  reason: string;
  awardedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
};
export type LmsReportDto = {
  bestProjects?: LmsReportProjectSnapshot[];
  id: number;
  runId: number;
  periodFrom: string;
  periodTo: string;
  comment: string;
  nextSteps: string;
  version: number;
  metrics: LmsProgressDto;
  publishedAt: string;
  authorName: string;
};
export type LmsHistoryDto = {
  id: number;
  runId: number;
  type: string;
  objectId: number | null;
  occurredAt: string;
  data: Record<string, unknown>;
};
export type LmsThreadDto = {
  unitId?: number | null;
  recipientId?: number | null;
  quizAttemptId?: number | null;
  stepUrl?: string | null;
  id: number;
  runId: number;
  title: string;
  audience: string;
  status: "open" | "answered" | "resolved";
  authorAccountId: number;
  createdAt: string;
  comments: LmsCommentDto[];
};
export type LmsAnnouncementDto = {
  id: number;
  runId: number;
  title: string;
  body: string;
  audience: string;
  publishAt: string;
  pinnedUntil: string | null;
  fileIds: number[];
  read: boolean;
};
export type LmsDashboardDto = {
  feedback?: LmsFeedbackDto[];
  nextMaterial?: { runId: number; publicationId: number; title: string } | null;
  nextLesson: LmsScheduleDto | null;
  assignments: LmsAssignmentDto[];
  makeup: LmsMakeupDto[];
  progress: LmsProgressDto;
  latestAchievement: LmsAchievementDto | null;
  announcements: LmsAnnouncementDto[];
};
export type LmsReviewQueueDto = LmsAssignmentDto & {
  reviewStartedName?: string | null;
  studentId: number;
  studentName: string;
  submissionId: number;
  submittedAt: string;
  attemptNumber: number;
  late: boolean;
  reviewStartedBy: number | null;
};
export type LmsAssignmentInput = z.infer<typeof lmsAssignmentSchema>;
export type LmsMaterialInput = z.infer<typeof lmsMaterialSchema>;
export type LmsDraftInput = z.infer<typeof lmsDraftSchema>;
export type LmsSubmitInput = z.infer<typeof lmsSubmitSchema>;
export type LmsReviewInput = z.infer<typeof lmsReviewSchema>;
export type LmsQuizInput = z.infer<typeof lmsQuizSchema>;
export type LmsQuizAnswerInput = z.infer<typeof lmsQuizAnswerSchema>;
export type LmsThreadInput = Omit<
  z.infer<typeof lmsThreadSchema>,
  "shareWithFamily"
> & { shareWithFamily?: boolean };
export type LmsCommentInput = z.infer<typeof lmsCommentSchema>;
export type LmsAnnouncementInput = z.infer<typeof lmsAnnouncementSchema>;
export type LmsReportInput = Omit<
  z.infer<typeof lmsReportSchema>,
  "bestProjectIds"
> & { bestProjectIds?: number[] };
export type LmsReportProjectSnapshot = {
  id: number;
  title: string;
  description: string;
  fileIds: number[];
  links: string[];
  review: string;
};
export type LmsStaffRunDto = {
  setupStatus?: "ready" | "preparing" | "needs_format" | "needs_course" | "needs_program_review";
  courseId?: number | null;
  permissions?: string[];
  canManageTemplates?: boolean;
  version?: number;
  format?: "offline" | "online";
  meetingUrl?: string | null;
  accessUntil?: string | null;
  runId: number | null;
  groupId: number;
  groupName: string;
  courseName: string | null;
  teacherName: string | null;
  status: string;
  studentCount: number;
  courseVersionId: number | null;
};
export type LmsStaffEnrollmentDto = {
  id: number;
  studentId: number;
  studentName: string;
  status: string;
  canReceiveLearning?: boolean;
  enrolledAt: string;
  endedAt: string | null;
};
export const isLmsLearningRecipient = (enrollment: LmsStaffEnrollmentDto) =>
  enrollment.status === "active" && enrollment.canReceiveLearning !== false;
export type LmsStaffSummaryDto = {
  assignmentResults?: LmsStaffAssignmentResultDto[];
  quizResults?: LmsStaffQuizResultDto[];
  openHelp?: number;
  absences?: number;
  completed?: boolean;
  runId: number;
  studentId: number;
  studentName: string;
  progress: LmsProgressDto;
};
export type LmsStaffAssignmentResultDto = {
  id: number;
  assignmentId: number;
  studentId: number;
  title: string;
  status: LmsAssignmentStatus;
  submissionId: number | null;
  score: number | null;
  maxScore: number | null;
  gradingMode: "acceptance" | "points";
  dueAt: string | null;
};
export type LmsStaffQuizResultDto = {
  id: number;
  quizId: number;
  studentId: number;
  title: string;
  status: string;
  bestPercent: number | null;
  passed: boolean;
  attemptsUsed: number;
};
export type LmsStaffReviewDetailDto = LmsAssignmentDetailDto & {
  studentId: number;
  studentName: string;
  submissionId: number;
  reviewStartedBy: number | null;
};
export const lmsPublishSchema = z.object({
  publishAt: z.string().datetime(),
  recipientEnrollmentIds: z.array(lmsIdSchema).min(1).max(500).optional(),
});
export const lmsThreadStatusSchema = z.object({
  status: z.enum(["open", "resolved"]),
});
export const lmsEnrollmentAssignmentsSchema = z.object({
  enrollmentId: lmsIdSchema,
  assignmentVersionIds: z.array(lmsIdSchema).min(1).max(100),
  opensAt: z.string().datetime(),
  dueAt: z.string().datetime().nullable(),
  reason: z.string().trim().min(1).max(2000),
});
export const lmsReopenAssignmentSchema = lmsVersionSchema.extend({
  reason: z.string().trim().min(1).max(2000),
  dueAt: z.string().datetime().nullable(),
});
export const lmsCourseVersionSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
  courseId: lmsIdSchema,
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(255),
        units: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(255),
              required: z.boolean().default(true),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
  publish: z.boolean().default(false),
});
export const lmsCompletionSchema = z.object({
  runId: lmsIdSchema,
  studentId: lmsIdSchema,
  reason: z.string().trim().min(1).max(2000),
});
export const lmsProgressQuerySchema = z
  .object({
    runId: lmsIdSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine(
    (value) =>
      (!value.from && !value.to) ||
      (Boolean(value.from) &&
        Boolean(value.to) &&
        +new Date(value.to!) > +new Date(value.from!)),
    "lmsDatesInvalid",
  );
export type LmsStaffMaterialDto = {
  videoUrl?: string | null;
  durationMinutes?: number | null;
  id: number;
  runId: number;
  unitId: number | null;
  state: "draft" | "published" | "archived";
  materialVersionId: number;
  version: number;
  title: string;
  body: string;
  category: "lesson" | "practice" | "repeat";
  links: string[];
  fileIds: number[];
  publishAt: string | null;
};
export type LmsStaffAssignmentDto = {
  id: number;
  runId: number;
  unitId: number | null;
  assignmentVersionId: number;
  title: string;
  body: string;
  required: boolean;
  opensAt: string;
  dueAt: string | null;
  recipientCount: number;
  acceptedCount: number;
  submittedCount: number;
  revisionCount: number;
};
export type LmsStaffQuizDto = {
  id: number;
  runId: number;
  unitId: number | null;
  state: string;
  title: string;
  required: boolean;
  passPercent: number;
  maxAttempts: number;
  timerSeconds: number | null;
  disclosure: string;
  recipientCount: number;
};
export type LmsStaffThreadDto = LmsThreadDto & {
  studentId: number;
  studentName: string;
};
export type LmsStaffRecipientDto = {
  latestSubmissionId?: number | null;
  id: number;
  studentId: number;
  studentName: string;
  enrollmentId: number;
  status: LmsAssignmentStatus;
  dueAt: string | null;
  opensAt: string;
  version: number;
};
export type LmsStaffAssignmentDetailDto = LmsStaffAssignmentDto & {
  gradingMode: "acceptance" | "points";
  maxScore: number | null;
  criteria: { id: string; title: string; weight: number }[];
  allowedAnswers: string[];
  fileIds: number[];
  recipients: LmsStaffRecipientDto[];
};
export type LmsStaffLessonDto = {
  id: number;
  lessonNumber: number;
  topic: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  unitId: number | null;
  format: "offline" | "online";
  meetingUrl: string | null;
};
export const lmsLessonBindingSchema = z.object({
  unitId: lmsIdSchema.nullable().default(null),
  format: z.enum(["offline", "online"]).nullable().default(null),
  meetingUrl: lmsHttpsSchema.nullable().default(null),
});
export type LmsStaffMakeupDto = Omit<LmsMakeupDto, "materials"> & {
  studentId: number;
  studentName: string;
  quizRecipientId: number | null;
};
export type LmsStaffQuizRecipientDto = {
  id: number;
  studentId: number;
  studentName: string;
  enrollmentId: number;
  status: string;
  opensAt: string;
  closesAt: string | null;
  attemptsUsed: number;
  maxAttempts: number;
  bestPercent: number | null;
  passed: boolean;
};
export type LmsStaffQuizDetailDto = LmsStaffQuizDto & {
  quizVersionId: number;
  instructions: string;
  questions: LmsQuizInput["questions"];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  recipients: LmsStaffQuizRecipientDto[];
};
export type LmsStaffCourseVersionDto = {
  id: number;
  courseId: number;
  version: number;
  state: string;
  createdAt: string;
  units: {
    id: number;
    title: string;
    position: number;
    required: boolean;
    sectionTitle: string | null;
  }[];
};

export type LmsFeedbackDto = {
  id: number;
  recipientId: number;
  submissionId: number;
  assignmentTitle: string;
  courseName: string;
  groupName: string;
  decision: "accepted" | "revision_required";
  comment: string;
  score: number | null;
  maxScore: number | null;
  reviewerName: string;
  createdAt: string;
};
export const LMS_STAFF_PERMISSIONS = [
  "content.manage",
  "assignments.manage",
  "reviews.manage",
  "quizzes.manage",
  "results.manage",
  "communication.manage",
  "announcements.manage",
  "schedule.manage",
  "access.manage",
  "portfolio.moderate",
] as const;
export const lmsStaffPermissionsSchema = z
  .object({
    permissions: z
      .array(z.enum(LMS_STAFF_PERMISSIONS))
      .max(LMS_STAFF_PERMISSIONS.length),
    reason: z.string().trim().min(1).max(2000),
  })
  .refine(
    (value) => new Set(value.permissions).size === value.permissions.length,
    "lmsInvalidRequest",
  );
export type LmsStaffPermissionDto = {
  modules?: string[];
  userId: number;
  fullName: string;
  module: string;
  permissions: string[];
};
export type LmsSubmissionReceiptDto = {
  id: number;
  attemptNumber: number;
  submittedAt: string;
  late: boolean;
  version: number;
  status: "submitted";
};
export type LmsMakeupOptionsDto = {
  assignments: { id: number; title: string; status: string }[];
  quizzes: { id: number; title: string; status: string }[];
};
export const lmsRunUpdateSchema = z.object({
  version: z.number().int().positive(),
  format: z.enum(["offline", "online"]).optional(),
  meetingUrl: lmsHttpsSchema.nullable().optional(),
  accessUntil: z.null().optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
  reason: z.string().trim().min(1).max(2000),
});
export type LmsRunUpdateInput = z.infer<typeof lmsRunUpdateSchema>;
export const lmsUnitPreviewSchema = z
  .object({
    enabled: z.boolean(),
    visibleFrom: z.string().datetime(),
    openAt: z.string().datetime(),
  })
  .refine(
    (value) => +new Date(value.openAt) >= +new Date(value.visibleFrom),
    "lmsDatesInvalid",
  );
