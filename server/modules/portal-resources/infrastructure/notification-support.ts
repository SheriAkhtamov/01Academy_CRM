import type { Pool, PoolClient } from "pg";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import type {
  PortalNotificationCategory,
  PortalNotificationPreferencesDto,
} from "@shared/contracts/portal-resources";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";

export const MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR,
  TASHKENT = 5 * HOUR;
export type Sql = Pick<PoolClient, "query">;
export type Params = Record<string, string | number>;
export type Candidate = {
  completedSourceKey?: string;
  sourceKey: string;
  eventKey: string;
  studentId: number | null;
  runId: number | null;
  groupId: number | null;
  category: PortalNotificationCategory;
  code: string;
  params: Params;
  href: string;
  permission: PortalPermission | null;
  alternativePermission?: PortalPermission;
  audience?: "self" | "representative";
  accountId?: number;
  deliverAt: number;
  urgent?: boolean;
};
export type Outbox = {
  id: string;
  account_id: number;
  link_id: number | null;
  category: PortalNotificationCategory;
  code: string;
  params: Params;
  href: string | null;
  event_key: string;
  required_permission: PortalPermission | null;
  channel: "in_app";
  urgent: boolean;
  attempts: number;
  deliver_after: Date;
  locked_at: Date | null;
};
export type Account = {
  id: number;
  locale: "ru" | "en";
  status: string;
};
export type NotificationWorkCalendar = {
  workdays: readonly number[];
  start: string;
  end: string;
  holidays: readonly string[];
};
export type PortalNotificationWorkerOptions = {
  pool: Pool;
  enabled: boolean | (() => boolean);
  groupIds?: readonly number[] | (() => readonly number[]);
  now?: () => number;
  enabledForGroup?: (groupId: number) => Promise<boolean> | boolean;
  enabledForStudent?: (studentId: number) => Promise<boolean> | boolean;
  rolloutStartedAt?: string | Date;
  batchSize?: number;
  calendar?: NotificationWorkCalendar | (() => NotificationWorkCalendar);
  coordinatorUserIds?: readonly number[] | (() => readonly number[]);
  authorizeLink: (
    accountId: number,
    linkId: number,
    permission?: PortalPermission,
  ) => Promise<PortalActorContext>;
  staffCopy?: (code: string, params: Params) => { title: string; message: string };
};
export const PORTAL_NOTIFICATION_EVENT_CODES = {
  material_published: "portalNoticeMaterialPublished",
  assignment_assigned: "portalNoticeAssignmentPublished",
  assignment_due: "portalNoticeAssignmentDue",
  assignment_overdue: "portalNoticeAssignmentOverdue",
  assignment_submitted: "portalNoticeAssignmentSubmitted",
  assignment_accepted: "portalNoticeAssignmentAccepted",
  assignment_revision_required: "portalNoticeAssignmentRevision",
  quiz_assigned: "portalNoticeQuizPublished",
  quiz_finished: "portalNoticeQuizFinished",
  lesson_rescheduled: "portalNoticeLessonRescheduled",
  lesson_cancelled: "portalNoticeLessonCancelled",
  attendance_absent: "portalNoticeAttendanceAbsent",
  thread_answered: "portalNoticeThreadAnswered",
  assignment_feedback: "portalNoticeFeedback",
  payment_due: "portalNoticePaymentDue",
  payment_overdue: "portalNoticePaymentOverdue",
  report_published: "portalNoticeReportPublished",
  achievement_awarded: "portalNoticeAchievementAwarded",
  achievement_revoked: "portalNoticeAchievementRevoked",
  course_completed: "portalNoticeCourseCompleted",
  course_reopened: "portalNoticeCourseReopened",
  announcement_published: "portalNoticeAnnouncement",
  password_changed: "portalNoticePasswordChanged",
  access_changed: "portalNoticeAccessChanged",
  family_weekly: "portalNoticeWeeklySummary",
} as const;
export const code = (type: keyof typeof PORTAL_NOTIFICATION_EVENT_CODES) =>
  PORTAL_NOTIFICATION_EVENT_CODES[type];
const timeMinutes = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};
export const localDate = (now: number) => new Date(now + TASHKENT).toISOString().slice(0, 10);
export function oneWorkingDayAfter(
  createdAt: number,
  calendar: NotificationWorkCalendar = {
    workdays: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "18:00",
    holidays: [],
  },
): number {
  const start = timeMinutes(calendar.start),
    end = timeMinutes(calendar.end);
  if (end <= start || !calendar.workdays.length) throw new Error("Invalid LMS working calendar");
  let cursor = createdAt;
  let remaining = (end - start) * MINUTE;
  for (let step = 0; step < 370; step++) {
    const local = new Date(cursor + TASHKENT);
    const dayStart =
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TASHKENT;
    if (
      !calendar.workdays.includes(local.getUTCDay()) ||
      calendar.holidays.includes(localDate(cursor))
    ) {
      cursor = dayStart + DAY + start * MINUTE;
      continue;
    }
    const workStart = dayStart + start * MINUTE,
      workEnd = dayStart + end * MINUTE;
    cursor = Math.max(cursor, workStart);
    if (cursor >= workEnd) {
      cursor = dayStart + DAY + start * MINUTE;
      continue;
    }
    const available = workEnd - cursor;
    if (remaining <= available) return cursor + remaining;
    remaining -= available;
    cursor = dayStart + DAY + start * MINUTE;
  }
  throw new Error("LMS working calendar has no available working days");
}
export const dateValue = (value: unknown) =>
  value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
export const number = (value: unknown) => Number(value);
export const accessDenied = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    (("status" in error && [401, 403, 404].includes(Number(error.status))) ||
      ("statusCode" in error && [401, 403, 404].includes(Number(error.statusCode)))),
  );
export const defaultPreferences = (): PortalNotificationPreferencesDto => ({
  categories: {
    learning: { inApp: true },
    schedule: { inApp: true },
    feedback: { inApp: true },
    finance: { inApp: true },
    family: { inApp: true },
    security: { inApp: true },
  },
  weeklySummary: false,
});
