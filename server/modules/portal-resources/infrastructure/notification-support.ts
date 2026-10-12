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
export type PortalNotificationWorkerOptions = {
  pool: Pool;
  enabled: boolean | (() => boolean);
  groupIds?: readonly number[] | (() => readonly number[]);
  now?: () => number;
  enabledForGroup?: (groupId: number) => Promise<boolean> | boolean;
  enabledForStudent?: (studentId: number) => Promise<boolean> | boolean;
  rolloutStartedAt?: string | Date;
  batchSize?: number;
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
export const localDate = (value: number) => new Date(value + TASHKENT).toISOString().slice(0, 10);
export const notificationEscalationAt = (createdAt: number) => createdAt + DAY;
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
