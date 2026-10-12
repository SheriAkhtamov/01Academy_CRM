import type {
  LmsStaffAssignmentDetailDto,
  LmsPage,
  LmsStaffLessonDto,
  LmsStaffCourseVersionDto,
  LmsStaffQuizDetailDto,
  LmsStaffMakeupDto,
  LmsReportDto,
  LmsAchievementDto,
  LmsStaffPermissionDto,
  LmsMakeupOptionsDto,
  LmsRunUpdateInput,
  LmsAnnouncementDto,
  LmsAnnouncementInput,
  LmsAssignmentInput,
  LmsStaffAssignmentDto,
  LmsStaffEnrollmentDto,
  LmsStaffMaterialDto,
  LmsMaterialInput,
  LmsQuizInput,
  LmsStaffQuizDto,
  LmsReviewInput,
  LmsReviewQueueDto,
  LmsStaffReviewDetailDto,
  LmsStaffRunDto,
  LmsStaffSummaryDto,
  LmsStaffThreadDto,
  LmsCommentInput,
  LmsReportInput,
  LmsAnalyticsDto,
  LmsTeacherSummaryDto,
} from "@shared/contracts/lms";
import type {
  PortalFileDto,
  PortalProjectDto,
  PortalProjectComparisonDto,
} from "@shared/contracts/portal-resources";
export class LmsStaffApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
async function transport<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetch(`/api/lms-management${path}`, {
      method,
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(body !== undefined && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body !== undefined
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new LmsStaffApiError(
        response.status,
        typeof result.code === "string"
          ? result.code
          : typeof result.error === "string"
            ? result.error
            : "",
      );
    return result as T;
  } catch (error) {
    if (error instanceof LmsStaffApiError || signal?.aborted) throw error;
    throw new LmsStaffApiError(0, "portalOffline");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
async function collection<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  let cursor: number | undefined;
  const seen = new Set<number>();
  do {
    const separator = path.includes("?") ? "&" : "?";
    const page = await transport<LmsPage<T> | T[]>(
      `${path}${separator}limit=100${cursor ? `&cursor=${cursor}` : ""}`,
      "GET",
      undefined,
      signal,
    );
    if (Array.isArray(page)) {
      items.push(...page);
      return items;
    }
    items.push(...page.items);
    if (!page.hasMore || page.nextCursor === null) return items;
    if (seen.has(page.nextCursor))
      throw new LmsStaffApiError(409, "lmsVersionConflict");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (!signal?.aborted);
  throw new DOMException("Aborted", "AbortError");
}
export const lmsStaffApi = {
  teacherSummary: (signal?: AbortSignal) =>
    transport<LmsTeacherSummaryDto>("/summary", "GET", undefined, signal),
  analytics: (days: 7 | 30, runId?: number, signal?: AbortSignal) =>
    transport<LmsAnalyticsDto>(
      `/analytics?days=${days}${runId ? `&runId=${runId}` : ""}`,
      "GET",
      undefined,
      signal,
    ),
  projects: (runId: number, studentId: number, signal?: AbortSignal) =>
    collection<PortalProjectDto>(
      `/portfolio/projects?runId=${runId}&studentId=${studentId}`,
      signal,
    ),
  reportProjects: (runId: number, studentId: number, signal?: AbortSignal) =>
    collection<PortalProjectDto>(
      `/portfolio/projects?runId=${runId}&studentId=${studentId}&verified=1`,
      signal,
    ),
  comparison: (runId: number, studentId: number, signal?: AbortSignal) =>
    transport<PortalProjectComparisonDto | null>(
      `/portfolio/comparison?runId=${runId}&studentId=${studentId}`,
      "GET",
      undefined,
      signal,
    ),
  saveComparison: (body: {
    runId: number;
    studentId: number;
    firstProjectId: number;
    latestProjectId: number;
    version: number;
  }) =>
    transport<PortalProjectComparisonDto>("/portfolio/comparison", "PUT", body),
  unitPreview: (
    runId: number,
    unitId: number,
    body: { enabled: boolean; visibleFrom: string; openAt: string },
  ) => transport(`/runs/${runId}/units/${unitId}/preview`, "PUT", body),
  updateRun: (runId: number, body: LmsRunUpdateInput) =>
    transport(`/runs/${runId}`, "PATCH", body),
  makeupOptions: (id: number, signal?: AbortSignal) =>
    transport<LmsMakeupOptionsDto>(
      `/makeup/${id}/options`,
      "GET",
      undefined,
      signal,
    ),
  staffPermissions: (signal?: AbortSignal) =>
    collection<LmsStaffPermissionDto>("/staff-permissions", signal),
  changeStaffPermissions: (
    userId: number,
    body: { permissions: string[]; reason: string },
  ) => transport(`/staff-permissions/${userId}`, "PUT", body),
  lessons: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffLessonDto>(`/runs/${runId}/lessons`, signal),
  bindLesson: (
    runId: number,
    lessonId: number,
    body: {
      unitId: number | null;
      format: "offline" | "online" | null;
      meetingUrl: string | null;
    },
  ) => transport(`/runs/${runId}/lesson-bindings/${lessonId}`, "PUT", body),
  courseVersions: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffCourseVersionDto>(
      `/runs/${runId}/course-versions`,
      signal,
    ),
  createCourseVersion: (body: {
    idempotencyKey?: string;
    courseId: number;
    sections: {
      title: string;
      units: { title: string; required: boolean }[];
    }[];
    publish: boolean;
  }) => transport("/course-versions", "POST", body),
  quiz: (id: number, signal?: AbortSignal) =>
    transport<LmsStaffQuizDetailDto>(
      `/quizzes/${id}`,
      "GET",
      undefined,
      signal,
    ),
  makeup: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffMakeupDto>(`/makeup?runId=${runId}`, signal),
  updateMakeup: (
    id: number,
    body: {
      recipientId?: number | null;
      quizRecipientId?: number | null;
      dueAt?: string | null;
      complete?: boolean;
    },
  ) => transport(`/makeup/${id}`, "PATCH", body),
  achievements: (runId: number, signal?: AbortSignal) =>
    collection<LmsAchievementDto & { studentId: number; studentName: string }>(
      `/achievements?runId=${runId}`,
      signal,
    ),
  revokeAchievement: (id: number, reason: string) =>
    transport(`/achievements/${id}/revoke`, "POST", { reason }),
  reports: (runId: number, signal?: AbortSignal) =>
    collection<LmsReportDto & { studentId: number; studentName: string }>(
      `/reports?runId=${runId}`,
      signal,
    ),
  runs: (signal?: AbortSignal) => collection<LmsStaffRunDto>("/runs", signal),
  createRun: (body: {
    groupId: number;
    format: "offline" | "online";
    meetingUrl: string | null;
  }) => transport<{ id: number }>("/runs", "POST", body),
  enrollments: (id: number, signal?: AbortSignal) =>
    collection<LmsStaffEnrollmentDto>(`/runs/${id}/enrollments`, signal),
  units: (id: number, signal?: AbortSignal) =>
    collection<{
      id: number;
      title: string;
      position: number;
      required: boolean;
      previewEnabled?: boolean;
      visibleFrom?: string | null;
      openAt?: string | null;
    }>(`/runs/${id}/units`, signal),
  materials: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffMaterialDto>(`/materials?runId=${runId}`, signal),
  material: (body: LmsMaterialInput, id?: number) =>
    transport<{ id: number }>(
      id ? `/materials/${id}` : "/materials",
      id ? "PATCH" : "POST",
      body,
    ),
  publishMaterial: (
    id: number,
    body: { publishAt: string; recipientEnrollmentIds?: number[] },
  ) => transport(`/materials/${id}/publish`, "POST", body),
  archiveMaterial: (id: number) =>
    transport(`/materials/${id}/archive`, "POST"),
  assignments: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffAssignmentDto>(`/assignments?runId=${runId}`, signal),
  assignment: (id: number, signal?: AbortSignal) =>
    transport<LmsStaffAssignmentDetailDto>(
      `/assignments/${id}`,
      "GET",
      undefined,
      signal,
    ),
  createAssignment: (body: LmsAssignmentInput) =>
    transport<{ id: number; recipientCount: number }>(
      "/assignments",
      "POST",
      body,
    ),
  assignEnrollment: (
    runId: number,
    body: {
      enrollmentId: number;
      assignmentVersionIds: number[];
      opensAt: string;
      dueAt: string | null;
      reason: string;
    },
  ) => transport(`/runs/${runId}/assignments/enrollment`, "POST", body),
  reviews: (runId?: number, signal?: AbortSignal) =>
    collection<LmsReviewQueueDto>(
      `/reviews${runId ? `?runId=${runId}` : ""}`,
      signal,
    ),
  review: (id: number, signal?: AbortSignal) =>
    transport<LmsStaffReviewDetailDto>(
      `/reviews/${id}`,
      "GET",
      undefined,
      signal,
    ),
  startReview: (id: number, version: number) =>
    transport<{ version: number; reviewStartedBy: number }>(
      `/reviews/${id}/start`,
      "POST",
      { version },
    ),
  decision: (id: number, body: LmsReviewInput) =>
    transport(`/reviews/${id}/decision`, "POST", body),
  assignmentComment: (recipientId: number, body: LmsCommentInput) =>
    transport(`/assignments/${recipientId}/comments`, "POST", body),
  recipient: (
    id: number,
    body: {
      version: number;
      dueAt?: string | null;
      status?: "assigned" | "excused" | "cancelled";
      reason: string;
    },
  ) => transport(`/assignments/${id}/recipient`, "PATCH", body),
  reopenAssignment: (
    id: number,
    body: { version: number; dueAt: string | null; reason: string },
  ) => transport(`/assignments/${id}/reopen`, "POST", body),
  quizzes: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffQuizDto>(`/quizzes?runId=${runId}`, signal),
  createQuiz: (body: LmsQuizInput) =>
    transport<{ id: number }>("/quizzes", "POST", body),
  extraAttempt: (recipientId: number, reason: string, idempotencyKey: string) =>
    transport(`/quizzes/${recipientId}/extra-attempt`, "POST", {
      reason,
      idempotencyKey,
    }),
  announcements: (runId: number, signal?: AbortSignal) =>
    collection<LmsAnnouncementDto>(`/announcements?runId=${runId}`, signal),
  createAnnouncement: (body: LmsAnnouncementInput) =>
    transport<{ id: number }>("/announcements", "POST", body),
  threads: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffThreadDto>(`/threads?runId=${runId}`, signal),
  thread: (id: number, signal?: AbortSignal) =>
    transport<LmsStaffThreadDto>(`/threads/${id}`, "GET", undefined, signal),
  threadComment: (id: number, body: LmsCommentInput) =>
    transport(`/threads/${id}/comments`, "POST", body),
  threadStatus: (id: number, status: "open" | "resolved") =>
    transport(`/threads/${id}`, "PATCH", { status }),
  results: (runId: number, signal?: AbortSignal) =>
    collection<LmsStaffSummaryDto>(`/results?runId=${runId}`, signal),
  report: (body: LmsReportInput) =>
    transport<{ id: number }>("/reports", "POST", body),
  award: (body: {
    runId: number;
    studentId: number;
    title: string;
    reason: string;
    eventKey: string;
  }) => transport("/achievements", "POST", body),
  complete: (body: { runId: number; studentId: number; reason: string }) =>
    transport("/course-completions", "POST", body),
  reopenCourse: (body: { runId: number; studentId: number; reason: string }) =>
    transport("/course-completions/reopen", "POST", body),
  file: (id: number, runId: number, signal?: AbortSignal) =>
    transport<PortalFileDto>(
      `/files/${id}/status?runId=${runId}`,
      "GET",
      undefined,
      signal,
    ),
  upload: (
    runId: number,
    file: File,
    signal?: AbortSignal,
    onProgress?: (percent: number) => void,
  ) =>
    new Promise<PortalFileDto>((resolve, reject) => {
      const body = new FormData();
      body.append("runId", String(runId));
      body.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/lms-management/files");
      xhr.withCredentials = true;
      xhr.timeout = 120000;
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      const abort = () => xhr.abort();
      signal?.addEventListener("abort", abort, { once: true });
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      const finish = () => signal?.removeEventListener("abort", abort);
      xhr.onload = () => {
        finish();
        let data: PortalFileDto & { code?: string };
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          reject(new LmsStaffApiError(xhr.status, ""));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new LmsStaffApiError(xhr.status, data.code ?? ""));
          return;
        }
        resolve(data);
      };
      xhr.onerror = () => {
        finish();
        reject(new LmsStaffApiError(0, "portalOffline"));
      };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => {
        finish();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) {
        finish();
        reject(new DOMException("Aborted", "AbortError"));
      } else xhr.send(body);
    }),
};
