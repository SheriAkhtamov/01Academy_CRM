import type {
  PortalAccountDto,
  PortalDeviceSessionDto,
  PortalPermission,
  PortalSessionDto,
} from "@shared/contracts/portal-identity";
import type {
  LmsFeedbackDto,
  LmsAssignmentDetailDto,
  LmsAssignmentDto,
  LmsCourseDetailDto,
  LmsCourseDto,
  LmsMaterialDto,
  LmsDashboardDto,
  LmsDraftDto,
  LmsDraftInput,
  LmsSubmitInput,
  LmsSubmissionReceiptDto,
  LmsScheduleDto,
  LmsProgressDto,
  LmsQuizDto,
  LmsQuizAttemptDto,
  LmsQuizAnswerInput,
  LmsMakeupDto,
  LmsAchievementDto,
  LmsReportDto,
  LmsHistoryDto,
  LmsThreadDto,
  LmsThreadInput,
  LmsCommentInput,
  LmsAnnouncementDto,
  LmsPage,
} from "@shared/contracts/lms";

import { portalSessionSchema } from "@shared/contracts/portal-identity";

export class PortalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
const accessErrorListeners = new Set<() => void>();
export function subscribePortalAccessErrors(listener: () => void) {
  accessErrorListeners.add(listener);
  return () => {
    accessErrorListeners.delete(listener);
  };
}
export function notifyPortalAccessError(error: PortalApiError) {
  if (
    error.status === 403 ||
    (error.status === 401 && error.code === "portalAuthenticationRequired")
  )
    accessErrorListeners.forEach((listener) => listener());
}
let csrfToken = "";
export function setPortalCsrf(value: string) {
  csrfToken = value;
}
export async function portalRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    onResponse?: (response: Response) => void;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  try {
    const response = await fetch(`/api/portal${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(options.method && options.method !== "GET"
          ? { "X-Portal-CSRF": csrfToken }
          : {}),
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    options.onResponse?.(response);
    const data =
      response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok)
      throw new PortalApiError(
        response.status,
        typeof data.error === "string"
          ? data.error
          : typeof data.code === "string"
            ? data.code
            : "",
      );
    return data as T;
  } catch (error) {
    if (error instanceof PortalApiError) {
      notifyPortalAccessError(error);
      throw error;
    }
    if (options.signal?.aborted) throw error;
    throw new PortalApiError(0, "portalOffline");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
async function sessionRequest(
  path: string,
  options: Parameters<typeof portalRequest>[1] = {},
) {
  const result = await portalRequest<unknown>(path, options);
  const parsed = portalSessionSchema.safeParse(result);
  if (!parsed.success) throw new PortalApiError(502, "portalLoadError");
  return parsed.data;
}
export const portalIdentityApi = {
  support: (signal?: AbortSignal) =>
    portalRequest<{
      schoolName: string;
      phone: string | null;
      email: string | null;
    }>("/support", { signal }),
  session: (signal?: AbortSignal) =>
    sessionRequest("/auth/session", { signal }),
  login: (identifier: string, password: string) =>
    sessionRequest("/auth/login", {
      method: "POST",
      body: { identifier, password },
    }),
  logout: () =>
    portalRequest<{ success: boolean }>("/auth/logout", { method: "POST" }),
  activate: (token: string, password?: string, fullName?: string) =>
    sessionRequest("/auth/invitations/accept", {
      method: "POST",
      body: {
        token,
        ...(password ? { password } : {}),
        ...(fullName ? { fullName } : {}),
      },
    }),
  profile: (body: { fullName?: string; locale?: "ru" | "en" }) =>
    portalRequest<PortalAccountDto>("/me", { method: "PATCH", body }),
  password: (password: string, newPassword: string) =>
    sessionRequest("/me/password", {
      method: "POST",
      body: { password, newPassword },
    }),
  reauthenticate: (password: string) =>
    portalRequest<{ success: boolean }>("/me/reauthenticate", {
      method: "POST",
      body: { password },
    }),
  representatives: (signal?: AbortSignal) =>
    portalRequest<
      Array<{
        linkId: number;
        fullName: string;
        relationship: "parent" | "guardian" | "payer" | "other" | null;
        permissions: PortalPermission[];
        status: "pending" | "active" | "suspended" | "revoked";
      }>
    >("/me/representatives", { signal }),
  consent: (
    linkId: number,
    permissions: PortalPermission[],
    approved: boolean,
  ) =>
    portalRequest<{ success: boolean }>("/me/representatives/consent", {
      method: "POST",
      body: { linkId, permissions, approved },
    }),
  sessions: (signal?: AbortSignal) =>
    portalRequest<PortalDeviceSessionDto[]>("/me/sessions", { signal }),
  revokeSession: (sessionId: string) =>
    portalRequest<{ success: boolean }>("/me/sessions/revoke", {
      method: "POST",
      body: { sessionId },
    }),
  childCredentials: (linkId: number, login: string, password: string) =>
    portalRequest<{ success: boolean }>(`/subjects/${linkId}/credentials`, {
      method: "POST",
      body: { login, password },
    }),
};
export type PortalProgressFilter = {
  runId?: number;
  from?: string;
  to?: string;
};
const filterQuery = (filter: PortalProgressFilter = {}) => {
  const params = new URLSearchParams();
  if (filter.runId) params.set("runId", String(filter.runId));
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  return params.toString() ? `?${params}` : "";
};
const subjectPath = (linkId: number, path: string) =>
  `/subjects/${linkId}/${path}`;
export async function collectPortalPages<T>(
  linkId: number,
  area: string,
  signal?: AbortSignal,
  filter?: PortalProgressFilter,
): Promise<T[]> {
  const items: T[] = [];
  const visited = new Set<number>();
  let cursor: number | undefined;
  while (true) {
    const page: LmsPage<T> = await portalRequest<LmsPage<T>>(
      subjectPath(
        linkId,
        `${area}?limit=100${cursor ? `&cursor=${cursor}` : ""}${filterQuery(filter).replace("?", "&")}`,
      ),
      { signal },
    );
    items.push(...page.items);
    if (!page.hasMore) return items;
    if (!page.nextCursor || visited.has(page.nextCursor))
      throw new PortalApiError(502, "portalLoadError");
    visited.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
export const portalLmsApi = {
  dashboard: (linkId: number, signal?: AbortSignal) =>
    portalRequest<LmsDashboardDto>(subjectPath(linkId, "dashboard"), {
      signal,
    }),
  communicationCourses: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<{
      runId: number;
      courseName: string;
      groupName: string;
    }>(linkId, "communication-courses", signal),
  courses: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<LmsCourseDto>(linkId, "courses", signal),
  materials: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<LmsMaterialDto>(linkId, "materials", signal),
  attendance: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<LmsScheduleDto>(linkId, "attendance", signal),
  course: (linkId: number, runId: number, signal?: AbortSignal) =>
    portalRequest<LmsCourseDetailDto>(subjectPath(linkId, `courses/${runId}`), {
      signal,
    }),
  assignments: async (
    linkId: number,
    signal?: AbortSignal,
  ): Promise<LmsPage<LmsAssignmentDto>> => ({
    items: await collectPortalPages<LmsAssignmentDto>(
      linkId,
      "assignments",
      signal,
    ),
    nextCursor: null,
    hasMore: false,
  }),
  assignment: (linkId: number, id: number, signal?: AbortSignal) =>
    portalRequest<LmsAssignmentDetailDto>(
      subjectPath(linkId, `assignments/${id}`),
      { signal },
    ),
  draft: (linkId: number, id: number, body: LmsDraftInput) =>
    portalRequest<LmsDraftDto>(subjectPath(linkId, `assignments/${id}/draft`), {
      method: "PUT",
      body,
    }),
  submit: (linkId: number, id: number, body: LmsSubmitInput) =>
    portalRequest<LmsSubmissionReceiptDto>(
      subjectPath(linkId, `assignments/${id}/submissions`),
      { method: "POST", body },
    ),
  withdraw: (linkId: number, id: number, version: number) =>
    portalRequest<unknown>(subjectPath(linkId, `assignments/${id}/withdraw`), {
      method: "POST",
      body: { version },
    }),
  comment: (linkId: number, id: number, body: LmsCommentInput) =>
    portalRequest<unknown>(subjectPath(linkId, `assignments/${id}/comments`), {
      method: "POST",
      body,
    }),
  materialRead: (linkId: number, id: number, read: boolean) =>
    portalRequest<unknown>(subjectPath(linkId, `materials/${id}/read`), {
      method: read ? "PUT" : "DELETE",
    }),
  schedule: (linkId: number, from: string, to: string, signal?: AbortSignal) =>
    collectPortalPages<LmsScheduleDto>(linkId, "schedule", signal, {
      from,
      to,
    }).then((items) =>
      items.sort(
        (a, b) =>
          +new Date(a.scheduledAt) - +new Date(b.scheduledAt) ||
          a.lessonId - b.lessonId,
      ),
    ),
  feedback: (linkId: number, signal?: AbortSignal, cursor?: number) =>
    portalRequest<LmsPage<LmsFeedbackDto>>(
      subjectPath(
        linkId,
        `feedback?limit=100${cursor ? `&cursor=${cursor}` : ""}`,
      ),
      { signal },
    ),
  feedbackDetail: (linkId: number, id: number, signal?: AbortSignal) =>
    portalRequest<LmsFeedbackDto>(subjectPath(linkId, `feedback/${id}`), {
      signal,
    }),
  progress: (
    linkId: number,
    signal?: AbortSignal,
    filter?: PortalProgressFilter,
  ) =>
    portalRequest<LmsProgressDto>(
      subjectPath(linkId, `progress${filterQuery(filter)}`),
      { signal },
    ),
  quizzes: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<LmsQuizDto>(linkId, "quizzes", signal),
  quizResults: (linkId: number, id: number, signal?: AbortSignal) =>
    portalRequest<LmsQuizAttemptDto>(
      subjectPath(linkId, `quizzes/${id}/results`),
      { signal },
    ),
  startQuiz: (linkId: number, id: number) =>
    portalRequest<LmsQuizAttemptDto>(
      subjectPath(linkId, `quizzes/${id}/attempts`),
      { method: "POST" },
    ),
  attempt: (linkId: number, id: number, signal?: AbortSignal) =>
    portalRequest<LmsQuizAttemptDto>(subjectPath(linkId, `attempts/${id}`), {
      signal,
    }),
  answer: (
    linkId: number,
    id: number,
    questionId: string,
    body: LmsQuizAnswerInput,
  ) =>
    portalRequest<LmsQuizAttemptDto>(
      subjectPath(
        linkId,
        `attempts/${id}/answers/${encodeURIComponent(questionId)}`,
      ),
      { method: "PUT", body },
    ),
  finishQuiz: (linkId: number, id: number, version: number) =>
    portalRequest<LmsQuizAttemptDto>(
      subjectPath(linkId, `attempts/${id}/finish`),
      { method: "POST", body: { version } },
    ),
  beginMakeup: (linkId: number, id: number) =>
    portalRequest<{ id: number; status: string }>(
      subjectPath(linkId, `makeup/${id}/start`),
      { method: "POST" },
    ),
  makeup: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<LmsMakeupDto>(linkId, "makeup", signal),
  achievements: (
    linkId: number,
    signal?: AbortSignal,
    filter?: PortalProgressFilter,
  ) =>
    collectPortalPages<LmsAchievementDto>(
      linkId,
      "achievements",
      signal,
      filter,
    ),
  reports: (
    linkId: number,
    signal?: AbortSignal,
    filter?: PortalProgressFilter,
  ) => collectPortalPages<LmsReportDto>(linkId, "reports", signal, filter),
  history: (
    linkId: number,
    signal?: AbortSignal,
    filter?: PortalProgressFilter,
    cursor?: number,
  ) =>
    portalRequest<LmsPage<LmsHistoryDto>>(
      subjectPath(
        linkId,
        `history?limit=100${cursor ? `&cursor=${cursor}` : ""}${filterQuery(filter).replace("?", "&")}`,
      ),
      { signal },
    ),
  thread: (linkId: number, id: number, signal?: AbortSignal) =>
    portalRequest<LmsThreadDto>(subjectPath(linkId, `threads/${id}`), {
      signal,
    }),
  threads: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<LmsThreadDto>(linkId, "threads", signal),
  createThread: (linkId: number, body: LmsThreadInput) =>
    portalRequest<{ id: number }>(subjectPath(linkId, "threads"), {
      method: "POST",
      body,
    }),
  threadComment: (linkId: number, id: number, body: LmsCommentInput) =>
    portalRequest<{ id: number }>(
      subjectPath(linkId, `threads/${id}/comments`),
      { method: "POST", body },
    ),
  threadStatus: (linkId: number, id: number, status: "open" | "resolved") =>
    portalRequest<{ status: string }>(subjectPath(linkId, `threads/${id}`), {
      method: "PATCH",
      body: { status },
    }),
  announcements: (linkId: number, signal?: AbortSignal) =>
    collectPortalPages<LmsAnnouncementDto>(linkId, "announcements", signal),
  readAnnouncement: (linkId: number, id: number) =>
    portalRequest<unknown>(subjectPath(linkId, `announcements/${id}/read`), {
      method: "POST",
    }),
};
