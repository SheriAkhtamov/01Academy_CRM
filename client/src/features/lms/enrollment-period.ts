import type { LmsEnrollmentPeriod } from "@shared/contracts/lms";

export const inEnrollmentPeriod = (date: string, period?: LmsEnrollmentPeriod) =>
  !period || (+new Date(date) >= +new Date(period.enrolledAt)
    && (!period.endedAt || +new Date(date) < +new Date(period.endedAt)));

export const enrollmentCourseHref = (runId: number, enrollmentId?: number) =>
  `/learn/courses/${runId}${enrollmentId ? `?enrollmentId=${enrollmentId}` : ""}`;

export const enrollmentMaterialHref = (runId: number, publicationId: number, enrollmentId?: number) =>
  `/learn/courses/${runId}/materials/${publicationId}${enrollmentId ? `?enrollmentId=${enrollmentId}` : ""}`;
