export const ACADEMY_BRAND_NAME = "01 Academy CRM";

export const ACADEMY_ROLES = [
  "admin",
  "head",
  "account_manager",
  "teacher",
  "operations_director",
  "smm_manager",
  "employee",
] as const;

export type AcademyRole = (typeof ACADEMY_ROLES)[number];

export const ACADEMY_ROLE_LABELS: Record<AcademyRole, { en: string; ru: string }> = {
  admin: { en: "Administrator", ru: "Администратор" },
  head: { en: "Head", ru: "Руководитель" },
  account_manager: { en: "Account Manager", ru: "Аккаунт-менеджер" },
  teacher: { en: "Teacher", ru: "Преподаватель" },
  operations_director: { en: "Operations Director", ru: "Операционный директор" },
  smm_manager: { en: "SMM Manager", ru: "SMM-менеджер" },
  employee: { en: "Employee", ru: "Сотрудник" },
};

export const LEAD_STATUSES = [
  { code: "new_request", name: "Новая заявка", color: "#2563eb", sortOrder: 10, activePipeline: true },
  { code: "first_contact", name: "Первый контакт", color: "#0ea5e9", sortOrder: 20, activePipeline: true },
  { code: "qualified", name: "Квалифицирован", color: "#14b8a6", sortOrder: 30, activePipeline: true },
  { code: "demo_invited", name: "Приглашён на демо", color: "#8b5cf6", sortOrder: 40, activePipeline: true },
  { code: "demo_attended", name: "Был на демо", color: "#a855f7", sortOrder: 50, activePipeline: true },
  { code: "offer", name: "Предложение", color: "#f59e0b", sortOrder: 60, activePipeline: true },
  { code: "thinking", name: "Думает", color: "#f97316", sortOrder: 70, activePipeline: true },
  { code: "enrolled", name: "Записан на курс", color: "#22c55e", sortOrder: 80, activePipeline: true },
  { code: "paid", name: "Оплатил", color: "#16a34a", sortOrder: 90, activePipeline: true },
  { code: "not_now", name: "Не сейчас", color: "#64748b", sortOrder: 100, activePipeline: false },
] as const;

export type LeadStatusCode = (typeof LEAD_STATUSES)[number]["code"];

export const ACTIVE_PIPELINE_STATUSES = LEAD_STATUSES
  .filter((status) => status.activePipeline)
  .map((status) => status.code);

export const STUDENT_STATUSES = [
  { code: "studying", name: "Учится", color: "#16a34a" },
  { code: "paused", name: "Приостановлен", color: "#f59e0b" },
  { code: "completed", name: "Завершил", color: "#2563eb" },
  { code: "expelled", name: "Отчислен", color: "#dc2626" },
] as const;

export const GROUP_STATUSES = [
  { code: "open", name: "Набор открыт", color: "#2563eb" },
  { code: "in_progress", name: "Идут занятия", color: "#16a34a" },
  { code: "completed", name: "Завершена", color: "#64748b" },
] as const;

export const LESSON_STATUSES = [
  { code: "scheduled", name: "Запланировано", color: "#2563eb" },
  { code: "conducted", name: "Проведено", color: "#16a34a" },
  { code: "cancelled", name: "Отменено", color: "#dc2626" },
] as const;

export const PAYMENT_STATUSES = [
  { code: "paid", name: "Оплачено", color: "#16a34a" },
  { code: "pending", name: "Ожидает", color: "#f59e0b" },
  { code: "overdue", name: "Просрочено", color: "#dc2626" },
] as const;

export const PAYMENT_TYPES = ["full", "installment_1_2", "installment_2_2"] as const;
export const PAYMENT_METHODS = ["cash", "transfer", "card"] as const;
export const PAYMENT_DISCOUNTS = ["promo_20", "family_15", "referral_15", "none"] as const;

export const DEFAULT_COURSES = [
  {
    slug: "ai-kids",
    name: "AI Kids",
    ageCategory: "7-10",
    lessonCount: 24,
    lessonDurationMinutes: 90,
    frequency: "2 раза в неделю",
    basePriceUzs: 1200000,
    discountedPriceUzs: 960000,
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
    ageCategory: "11-15",
    lessonCount: 36,
    lessonDurationMinutes: 120,
    frequency: "2 раза в неделю",
    basePriceUzs: 1440000,
    discountedPriceUzs: 1224000,
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
    ageCategory: "16+",
    lessonCount: 32,
    lessonDurationMinutes: 120,
    frequency: "2 раза в неделю",
    basePriceUzs: 2500000,
    discountedPriceUzs: 2125000,
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

export const DEFAULT_LEAD_SOURCES = [
  "instagram_dm",
  "instagram_ad_default",
  "instagram_reels",
  "tiktok",
  "telegram_channel",
  "telegram_chat",
  "telegram_ad",
  "blogger_default",
  "school_default",
  "event_default",
  "referral_default",
  "website",
  "organic",
] as const;

export type AcademyCourseSeed = (typeof DEFAULT_COURSES)[number];

export function suggestCourseSlugByAge(age?: number | null): string | null {
  if (!age || age < 1) return null;
  if (age <= 10) return "ai-kids";
  if (age <= 15) return "ai-creator";
  return "vibe-coding";
}

export function suggestAgeGroup(age?: number | null): string | null {
  if (!age || age < 1) return null;
  if (age <= 10) return "7-10";
  if (age <= 15) return "11-15";
  return "16+";
}

export function requiresQualificationFields(status: string): boolean {
  return status === "qualified";
}

export function validateLeadForStatusChange(input: {
  nextStatus: string;
  studentName?: string | null;
  studentAge?: number | null;
  courseId?: number | null;
}): string | null {
  if (!requiresQualificationFields(input.nextStatus)) {
    return null;
  }

  if (!input.studentName?.trim() || !input.studentAge || !input.courseId) {
    return "Для перевода в статус «Квалифицирован» заполните имя ученика, возраст и курс.";
  }

  return null;
}

export function getComputedPaymentStatus(status: string, dueAt?: string | Date | null): string {
  if (status === "paid") return "paid";
  if (!dueAt) return status;

  const dueDate = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) return status;

  return dueDate.getTime() < Date.now() ? "overdue" : status;
}

export function calculateAttendancePercent(presentCount: number, conductedLessonsCount: number): number {
  if (conductedLessonsCount <= 0) return 0;
  return Math.round((presentCount / conductedLessonsCount) * 100);
}

export function calculateProgressPercent(completedLessonsCount: number, totalLessonsCount: number): number {
  if (totalLessonsCount <= 0) return 0;
  return Math.min(100, Math.round((completedLessonsCount / totalLessonsCount) * 100));
}

export function calculateNps(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((score) => score >= 9).length;
  const detractors = scores.filter((score) => score <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
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

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function deriveGroupEndDate(startDate: Date, lessonCount: number, sessionsPerWeek = 2): Date {
  const safeLessonCount = Math.max(1, lessonCount);
  const safeSessionsPerWeek = Math.max(1, sessionsPerWeek);
  const totalWeeks = Math.ceil(safeLessonCount / safeSessionsPerWeek);
  return addDays(startDate, totalWeeks * 7);
}

export function normalizeMoney(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}
