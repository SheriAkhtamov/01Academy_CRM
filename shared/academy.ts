export const ACADEMY_BRAND_NAME = "01 Academy CRM";

export const ACADEMY_WORKSPACES = [
  "administration",
  "sales",
  "teacher",
  "marketing",
] as const;

export type AcademyWorkspace = (typeof ACADEMY_WORKSPACES)[number];
export const ACADEMY_ACCESS_MODULES = [
  ...ACADEMY_WORKSPACES,
  "finance",
] as const;
export type AcademyAccessModule = (typeof ACADEMY_ACCESS_MODULES)[number];
export type WorkspaceAccessSource =
  | string
  | readonly string[]
  | {
      workspace?: string | null;
      workspaces?: readonly string[] | null;
    }
  | null
  | undefined;

const academyAccessModuleSet = new Set<string>(ACADEMY_ACCESS_MODULES);
const isWorkspaceArray = (source: WorkspaceAccessSource): source is readonly string[] =>
  Array.isArray(source);

export const LEADERSHIP_WORKSPACES = [
  "administration",
] as const;

export function isLeadershipWorkspace(
  workspace: string | null | undefined,
): boolean {
  return (LEADERSHIP_WORKSPACES as readonly string[]).includes(String(workspace));
}

export function getAssignedWorkspaces(
  source: WorkspaceAccessSource,
): AcademyAccessModule[] {
  let rawWorkspaces: readonly string[];
  if (!source) {
    rawWorkspaces = [];
  } else if (typeof source === "string") {
    rawWorkspaces = [source];
  } else if (isWorkspaceArray(source)) {
    rawWorkspaces = source;
  } else {
    rawWorkspaces = [
      ...(source.workspaces ?? []),
      ...(source.workspace ? [source.workspace] : []),
    ];
  }

  const normalized = rawWorkspaces
    .map((workspace) => String(workspace))
    .filter((workspace): workspace is AcademyAccessModule => academyAccessModuleSet.has(workspace));

  return [...new Set(normalized)];
}

export function hasFinanceAccess(source: WorkspaceAccessSource): boolean {
  // Finance is deliberately direct-only: the administration module must not
  // silently grant access to salaries, expenses, or profit data.
  return getAssignedWorkspaces(source).includes("finance");
}

export function hasLeadershipAccess(source: WorkspaceAccessSource): boolean {
  return getAssignedWorkspaces(source).some(isLeadershipWorkspace);
}

export function canAccessAcademyWorkspace(
  assignedWorkspace: WorkspaceAccessSource,
  workspace: AcademyWorkspace,
): boolean {
  // Leadership workspaces intentionally bypass department boundaries so
  // the head can investigate and act in any area without a second account.
  const assignedWorkspaces = getAssignedWorkspaces(assignedWorkspace);
  return assignedWorkspaces.some(isLeadershipWorkspace) || assignedWorkspaces.includes(workspace);
}

export const LEAD_STATUSES = [
  { code: "new_request", name: "Новая заявка", translationKey: "leadStatusNewRequest", color: "#2563eb", sortOrder: 10, activePipeline: true },
  { code: "first_contact", name: "Первый контакт", translationKey: "leadStatusFirstContact", color: "#0ea5e9", sortOrder: 20, activePipeline: true },
  { code: "qualified", name: "Квалифицирован", translationKey: "leadStatusQualified", color: "#14b8a6", sortOrder: 30, activePipeline: true },
  { code: "demo_invited", name: "Приглашён на демо", translationKey: "leadStatusDemoInvited", color: "#8b5cf6", sortOrder: 40, activePipeline: true },
  { code: "demo_attended", name: "Был на демо", translationKey: "leadStatusDemoAttended", color: "#a855f7", sortOrder: 50, activePipeline: true },
  { code: "offer", name: "Предложение", translationKey: "leadStatusOffer", color: "#f59e0b", sortOrder: 60, activePipeline: true },
  { code: "thinking", name: "Думает", translationKey: "leadStatusThinking", color: "#f97316", sortOrder: 70, activePipeline: true },
  { code: "enrolled", name: "Записан на курс", translationKey: "leadStatusEnrolled", color: "#22c55e", sortOrder: 80, activePipeline: true },
  { code: "paid", name: "Оплатил", translationKey: "leadStatusPaid", color: "#16a34a", sortOrder: 90, activePipeline: true },
  { code: "not_now", name: "Не сейчас", translationKey: "leadStatusNotNow", color: "#64748b", sortOrder: 100, activePipeline: false },
] as const;

export const DEFAULT_LEAD_SOURCES = [
  { code: "telegram", name: "Telegram", channel: "telegram" },
  { code: "instagram", name: "Instagram", channel: "instagram" },
  { code: "referral", name: "Рекомендация знакомых", channel: "referral" },
  { code: "website", name: "Сайт", channel: "website" },
  { code: "facebook", name: "Facebook", channel: "facebook" },
] as const;

export const ACTIVE_PIPELINE_STATUSES = LEAD_STATUSES
  .filter((status) => status.activePipeline)
  .map((status) => status.code);

export const LEAD_ARCHIVE_REASONS = [
  { code: "no_answer", translationKey: "archiveReasonNoAnswer", label: "Не отвечает" },
  { code: "not_interested", translationKey: "archiveReasonNotInterested", label: "Не заинтересован" },
  { code: "no_budget", translationKey: "archiveReasonNoBudget", label: "Нет бюджета" },
  { code: "schedule_conflict", translationKey: "archiveReasonScheduleConflict", label: "Не подходит расписание" },
  { code: "chose_competitor", translationKey: "archiveReasonChoseCompetitor", label: "Выбрал конкурента" },
  { code: "wrong_contact", translationKey: "archiveReasonWrongContact", label: "Неверный контакт" },
  { code: "duplicate_or_invalid", translationKey: "archiveReasonDuplicateOrInvalid", label: "Дубль или невалидная заявка" },
  { code: "other", translationKey: "archiveReasonOther", label: "Другая причина" },
] as const;

export const LEAD_ARCHIVE_REASON_CODES = LEAD_ARCHIVE_REASONS.map((reason) => reason.code);
export type LeadArchiveReasonCode = (typeof LEAD_ARCHIVE_REASONS)[number]["code"];

export const STUDENT_STATUSES = [
  { code: "studying", translationKey: "studentStatusStudying", color: "#16a34a" },
  { code: "paused", translationKey: "studentStatusPaused", color: "#f59e0b" },
  { code: "completed", translationKey: "studentStatusCompleted", color: "#2563eb" },
  { code: "expelled", translationKey: "studentStatusExpelled", color: "#dc2626" },
] as const;

export const FINAL_PROJECT_STATUSES = [
  { code: "not_started", translationKey: "finalProjectStatusNotStarted", color: "#64748b" },
  { code: "in_progress", translationKey: "finalProjectStatusInProgress", color: "#f59e0b" },
  { code: "completed", translationKey: "finalProjectStatusCompleted", color: "#2563eb" },
  { code: "presented", translationKey: "finalProjectStatusPresented", color: "#16a34a" },
] as const;

// Referral tier thresholds from TZ 5.1: 1 → 15% discount, 3 → free month, 5+ → AI Ambassador.
export const REFERRAL_TIERS = [
  { minReferrals: 5, level: "ai_ambassador", rewardKey: "freeTrainingAiAmbassador" },
  { minReferrals: 3, level: "free_month", rewardKey: "freeMonth" },
  { minReferrals: 1, level: "discount_15", rewardKey: "referralDiscount15" },
] as const;

export const REFERRAL_BENEFIT_TYPES = [
  "referred_first_payment_discount_15",
  "next_payment_discount_15",
  "free_month",
  "ai_ambassador_free_training",
] as const;
export type ReferralBenefitType = (typeof REFERRAL_BENEFIT_TYPES)[number];

export const REFERRAL_BENEFIT_STATUSES = ["pending", "consumed", "superseded"] as const;

export const TARGET_NPS = 50;
export const TARGET_CAC_UZS = 300000;
export const TARGET_LTV_CAC_RATIO = 10;
export const TARGET_ROAS = 5;
export const TARGET_ATTENDANCE_PERCENT = 70;

export const GROUP_STATUSES = [
  { code: "open", translationKey: "groupStatusOpen", color: "#2563eb" },
  { code: "in_progress", translationKey: "groupStatusInProgress", color: "#16a34a" },
  { code: "completed", translationKey: "groupStatusCompleted", color: "#64748b" },
] as const;

export const LESSON_STATUSES = [
  { code: "scheduled", translationKey: "lessonStatusScheduled", color: "#2563eb" },
  { code: "conducted", translationKey: "lessonStatusConducted", color: "#16a34a" },
  { code: "cancelled", translationKey: "lessonStatusCancelled", color: "#dc2626" },
] as const;

export const PAYMENT_STATUSES = [
  { code: "paid", translationKey: "paymentStatusPaid", color: "#16a34a" },
  { code: "pending", translationKey: "paymentStatusPending", color: "#f59e0b" },
  { code: "overdue", translationKey: "paymentStatusOverdue", color: "#dc2626" },
  { code: "refunded", translationKey: "paymentStatusRefunded", color: "#64748b" },
] as const;

export const CHURN_REASONS = [
  "relocation",
  "price",
  "quality",
  "schedule_conflict",
  "lost_interest",
] as const;

export const CHURN_REASON_LABELS: Record<(typeof CHURN_REASONS)[number], string> = {
  relocation: "Переезд",
  price: "Дорого",
  quality: "Не понравилось качество",
  schedule_conflict: "Конфликт расписания",
  lost_interest: "Потеря интереса",
};

export const PAYMENT_TYPES = ["full", "installment_1_2", "installment_2_2"] as const;
export const PAYMENT_METHODS = ["cash", "transfer", "card"] as const;
export const PAYMENT_DISCOUNTS = ["promo_20", "family_15", "referral_15", "none"] as const;

export const DEFAULT_COURSES = [
  {
    slug: "ai-kids",
    name: "AI Kids",
    ageCategory: "7-10",
    lessonCount: 16,
    lessonDurationMinutes: 120,
    frequency: "1 раз в неделю",
    basePriceUzs: 1500000,
    discountedPriceUzs: 1200000,
    ltvTargetMinUzs: 4800000,
    ltvTargetMaxUzs: 6000000,
    program: [
      { lessonNumber: 1, topic: "Знакомство с AI", description: "Что такое искусственный интеллект и как дети уже используют его каждый день" },
      { lessonNumber: 2, topic: "Промпты и безопасность", description: "Как задавать вопросы AI и проверять ответы" },
      { lessonNumber: 3, topic: "AI-рисование", description: "Создание картинок по описанию" },
      { lessonNumber: 4, topic: "Истории и персонажи", description: "Сценарии, герои и мини-комиксы" },
    ],
  },
  {
    slug: "ai-creator",
    name: "AI Creator",
    ageCategory: "10-15",
    lessonCount: 24,
    lessonDurationMinutes: 120,
    frequency: "1 раз в неделю",
    basePriceUzs: 1800000,
    discountedPriceUzs: 1440000,
    ltvTargetMinUzs: 8640000,
    ltvTargetMaxUzs: 10080000,
    program: [
      { lessonNumber: 1, topic: "AI-инструменты создателя", description: "Тексты, изображения, видео и презентации" },
      { lessonNumber: 2, topic: "Контент-план", description: "Идея, аудитория, формат и публикация" },
      { lessonNumber: 3, topic: "AI-видео", description: "Сценарии, раскадровка и генерация видео" },
      { lessonNumber: 4, topic: "Финальный проект", description: "Портфолио-проект с AI-инструментами" },
    ],
  },
  {
    slug: "vibe-coding",
    name: "Vibe Coding",
    ageCategory: "15+",
    lessonCount: 60,
    lessonDurationMinutes: 120,
    frequency: "3 раза в неделю",
    basePriceUzs: 2500000,
    discountedPriceUzs: 2000000,
    ltvTargetMinUzs: 10000000,
    ltvTargetMaxUzs: 10000000,
    program: [
      { lessonNumber: 1, topic: "Vibe Coding workflow", description: "Как собирать продукт с AI-ассистентом" },
      { lessonNumber: 2, topic: "Frontend basics", description: "Интерфейсы, компоненты и состояние" },
      { lessonNumber: 3, topic: "Backend basics", description: "API, данные и интеграции" },
      { lessonNumber: 4, topic: "Запуск проекта", description: "Деплой, QA и демонстрация результата" },
    ],
  },
] as const;

export function suggestCourseSlugByAge(age?: number | null): string | null {
  if (!age || age < 1) return null;
  if (age <= 10) return "ai-kids";
  if (age <= 15) return "ai-creator";
  return "vibe-coding";
}

export function suggestAgeGroup(age?: number | null): string | null {
  if (!age || age < 1) return null;
  if (age <= 10) return "7-10";
  if (age <= 15) return "10-15";
  return "15+";
}

function requiresQualificationFields(status: string): boolean {
  // Enrollment and payment are later pipeline stages, so qualification data
  // must remain complete there as well. Otherwise a PATCH could erase the
  // student/course fields after qualification and leave an unusable student.
  return ["qualified", "enrolled", "paid"].includes(status);
}

export function validateLeadForStatusChange(input: {
  nextStatus: string;
  studentName?: string | null;
  studentAge?: number | null;
  courseId?: number | null;
  enrolledGroupId?: number | null;
}): string | null {
  if (
    ["enrolled", "paid"].includes(input.nextStatus)
    && (!Number.isInteger(Number(input.enrolledGroupId)) || Number(input.enrolledGroupId) <= 0)
  ) {
    return "groupRequiredForEnrollment";
  }

  if (!requiresQualificationFields(input.nextStatus)) {
    return null;
  }

  if (
    !input.studentName?.trim()
    || !Number.isInteger(Number(input.studentAge))
    || Number(input.studentAge) <= 0
    || !Number.isInteger(Number(input.courseId))
    || Number(input.courseId) <= 0
  ) {
    return "completeQualificationFields";
  }

  return null;
}

export function validateLeadStatusTransition(currentStatus: string, nextStatus: string): string | null {
  if (currentStatus === "paid" && nextStatus !== "paid") {
    return "paidLeadCannotReturn";
  }
  if (currentStatus !== "paid" && nextStatus === "paid") {
    return "paymentRequiredBeforePaid";
  }
  return null;
}

export function getComputedPaymentStatus(status: string, dueAt?: string | Date | null): string {
  if (status !== "pending") return status;
  if (!dueAt) return status;

  const dueDate = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) return status;

  return dueDate.getTime() < Date.now() ? "overdue" : status;
}

export function calculateAttendancePercent(presentCount: number, conductedLessonsCount: number): number {
  if (!Number.isFinite(presentCount) || !Number.isFinite(conductedLessonsCount) || conductedLessonsCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((presentCount / conductedLessonsCount) * 100)));
}

export function calculateProgressPercent(completedLessonsCount: number, totalLessonsCount: number): number {
  if (!Number.isFinite(completedLessonsCount) || !Number.isFinite(totalLessonsCount) || totalLessonsCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((completedLessonsCount / totalLessonsCount) * 100)));
}

export function calculateNps(scores: number[]): number | null {
  const validScores = scores.filter((score) => Number.isInteger(score) && score >= 0 && score <= 10);
  if (validScores.length === 0) return null;
  const promoters = validScores.filter((score) => score >= 9).length;
  const detractors = validScores.filter((score) => score <= 6).length;
  return Math.round(((promoters - detractors) / validScores.length) * 100);
}

// Trend: compares the average of the last `windowSize` points with the previous window.
// Returns 'up' | 'down' | 'stable' (stable when the difference is < tolerance).
export function calculateTrend(
  values: number[],
  windowSize = 3,
  tolerance = 0.1,
): "up" | "down" | "stable" {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < windowSize * 2) return "stable";

  const recent = finite.slice(-windowSize);
  const previous = finite.slice(-windowSize * 2, -windowSize);
  const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
  const previousAvg = previous.reduce((sum, v) => sum + v, 0) / previous.length;

  if (previousAvg === 0) return recentAvg > 0 ? "up" : "stable";
  const delta = (recentAvg - previousAvg) / previousAvg;
  if (delta > tolerance) return "up";
  if (delta < -tolerance) return "down";
  return "stable";
}

// Retention rate as a percentage: cohort size at month N vs month 1.
export function calculateRetentionPercent(currentCount: number, baseCount: number): number {
  if (baseCount <= 0) return 0;
  return Math.round((currentCount / baseCount) * 100);
}

export function calculateAverage(values: number[]): number | null {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (validValues.length === 0) return null;
  return Math.round(validValues.reduce((sum, value) => sum + value, 0) / validValues.length);
}

export function calculateCac(expensesUzs: number, paidStudentsCount: number): number | null {
  if (expensesUzs <= 0 || paidStudentsCount <= 0) return null;
  return Math.round(expensesUzs / paidStudentsCount);
}

export function calculateRoas(revenueUzs: number, expensesUzs: number): number | null {
  if (expensesUzs <= 0) return null;
  return Number((revenueUzs / expensesUzs).toFixed(2));
}

export function calculateLtv(paymentAmountsUzs: number[]): number {
  return paymentAmountsUzs.reduce((sum, amount) => sum + (Number.isFinite(amount) ? amount : 0), 0);
}

export function buildReferralCode(studentName: string, fallbackId: number | string, year = new Date().getFullYear()): string {
  const normalized = studentName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);

  return `${normalized || "STUDENT"}${fallbackId}${year}`.slice(0, 24);
}

// Maps a paid-referral count to the corresponding tier from TZ 5.1.
export function resolveReferralLevel(paidReferralsCount: number): string {
  for (const tier of REFERRAL_TIERS) {
    if (paidReferralsCount >= tier.minReferrals) {
      return tier.level;
    }
  }
  return "none";
}

/** One-time benefits are granted only when a referral milestone is first reached. */
export function resolveReferralMilestone(
  paidReferralsCount: number,
): Extract<ReferralBenefitType, "next_payment_discount_15" | "free_month" | "ai_ambassador_free_training"> | null {
  if (paidReferralsCount === 1) return "next_payment_discount_15";
  if (paidReferralsCount === 3) return "free_month";
  if (paidReferralsCount === 5) return "ai_ambassador_free_training";
  return null;
}

// Average deal cycle (days) from lead creation to first paid payment.
export function calculateAvgDealCycleDays(cycleDays: number[]): number | null {
  const valid = cycleDays.filter((d) => Number.isFinite(d) && d >= 0);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((sum, d) => sum + d, 0) / valid.length) * 10) / 10;
}

// Average study duration in months from enrollment/first payment until now or completion.
export function calculateAvgStudyMonths(monthsValues: number[]): number | null {
  const valid = monthsValues.filter((m) => Number.isFinite(m) && m >= 0);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((sum, m) => sum + m, 0) / valid.length) * 10) / 10;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function normalizeMoney(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

export function resolveStudentRiskFlags(metrics: {
  conductedCount: number;
  attendancePercent: number;
  monthConductedCount: number;
  monthAttendancePercent: number;
  satisfactionAvg: number;
}): string[] {
  const flags: string[] = [];
  if (metrics.conductedCount > 0 && metrics.attendancePercent < 70) {
    flags.push("attendance_below_70");
  }
  if (metrics.monthConductedCount > 0 && metrics.monthAttendancePercent < 50) {
    flags.push("churn_risk");
  }
  if (metrics.satisfactionAvg > 0 && metrics.satisfactionAvg < 3) {
    flags.push("low_satisfaction");
  }
  return flags;
}
