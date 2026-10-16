import type {
  PortalFinanceQuestionDto,
  PortalFinanceQuestionDetailDto,
  PortalFinanceQuestionInput,
  PortalProjectComparisonDto,
  PortalProjectComparisonInput,
  PortalFileDto,
  PortalNotificationCollectionDto,
  PortalNotificationPreferencesDto,
  PortalPaymentsPageDto,
  PortalResourcePageDto,
  PortalProjectDto,
  PortalProjectInput,
  PortalPublicProjectDto,
  PortalShareDto,
  PortalShareInput,
} from "@shared/contracts/portal-resources";
import { portalResourcePageSchema } from "@shared/contracts/portal-resources";
import { PortalApiError, portalRequest, notifyPortalAccessError } from "./api";
let uploadCsrf = "";
export function setUploadCsrf(token: string) {
  uploadCsrf = token;
}
function normalizeResourcePage<TPage extends PortalResourcePageDto<unknown>>(
  value: unknown,
): TPage {
  const parsed = portalResourcePageSchema.safeParse(value);
  if (!parsed.success) throw new PortalApiError(502, "portalLoadError");
  return parsed.data as unknown as TPage;
}
export async function portalResourcePage<T>(
  path: string,
  signal?: AbortSignal,
  cursor?: number,
): Promise<PortalResourcePageDto<T>> {
  return normalizeResourcePage<PortalResourcePageDto<T>>(
    await portalRequest<unknown>(
      `${path}${path.includes("?") ? "&" : "?"}limit=30${cursor ? `&cursor=${cursor}` : ""}`,
      { signal },
    ),
  );
}
async function collectResourcePages<T>(
  load: (cursor?: number) => Promise<{ items: T[]; nextCursor: number | null }>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<number>();
  let cursor: number | undefined;
  while (true) {
    const page = await load(cursor);
    items.push(...page.items);
    if (page.nextCursor === null) return items;
    if (seen.has(page.nextCursor))
      throw new PortalApiError(502, "portalLoadError");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
export const portalResourcesApi = {
  projectComparison: (linkId: number, runId: number, signal?: AbortSignal) =>
    portalRequest<PortalProjectComparisonDto | null>(
      `/subjects/${linkId}/project-comparison?runId=${runId}`,
      { signal },
    ),
  saveComparison: (linkId: number, body: PortalProjectComparisonInput) =>
    portalRequest<PortalProjectComparisonDto>(
      `/subjects/${linkId}/project-comparison`,
      { method: "PUT", body },
    ),
  financeQuestions: (linkId: number, signal?: AbortSignal) =>
    collectResourcePages((cursor) =>
      portalResourcePage<PortalFinanceQuestionDto>(
        `/subjects/${linkId}/finance-questions`,
        signal,
        cursor,
      ),
    ),
  financeQuestionsPage: (
    linkId: number,
    signal?: AbortSignal,
    cursor?: number,
  ) =>
    portalResourcePage<PortalFinanceQuestionDto>(
      `/subjects/${linkId}/finance-questions`,
      signal,
      cursor,
    ),
  financeQuestion: (linkId: number, id: number, signal?: AbortSignal) =>
    portalRequest<PortalFinanceQuestionDetailDto>(
      `/subjects/${linkId}/finance-questions/${id}/messages`,
      { signal },
    ),
  askFinance: (linkId: number, body: PortalFinanceQuestionInput) =>
    portalRequest<PortalFinanceQuestionDetailDto>(
      `/subjects/${linkId}/finance-questions`,
      { method: "POST", body },
    ),
  replyFinance: (
    linkId: number,
    id: number,
    body: { body: string; idempotencyKey: string },
  ) =>
    portalRequest<PortalFinanceQuestionDetailDto>(
      `/subjects/${linkId}/finance-questions/${id}/messages`,
      { method: "POST", body },
    ),
  filePolicy: (signal?: AbortSignal) =>
    portalRequest<{ maxFileMiB: number; studentQuotaGiB: number }>(
      "/file-policy",
      { signal },
    ),
  projectSource: (linkId: number, submissionId: number, signal?: AbortSignal) =>
    portalRequest<PortalProjectInput>(
      `/subjects/${linkId}/projects/source/${submissionId}`,
      { signal },
    ),
  projects: (linkId: number, signal?: AbortSignal) =>
    collectResourcePages((cursor) =>
      portalResourcePage<PortalProjectDto>(
        `/subjects/${linkId}/projects`,
        signal,
        cursor,
      ),
    ),
  projectsPage: (linkId: number, signal?: AbortSignal, cursor?: number) =>
    portalResourcePage<PortalProjectDto>(
      `/subjects/${linkId}/projects`,
      signal,
      cursor,
    ),
  saveProject: (linkId: number, body: PortalProjectInput, id?: number) =>
    portalRequest<PortalProjectDto>(
      `/subjects/${linkId}/projects${id ? `/${id}` : ""}`,
      { method: id ? "PATCH" : "POST", body },
    ),
  archiveProject: (linkId: number, id: number, version: number) =>
    portalRequest<{ success: boolean }>(`/subjects/${linkId}/projects/${id}`, {
      method: "DELETE",
      body: { version },
    }),
  share: (linkId: number, projectId: number, body: PortalShareInput) =>
    portalRequest<PortalShareDto>(
      `/subjects/${linkId}/projects/${projectId}/shares`,
      { method: "POST", body },
    ),
  approve: (linkId: number, shareId: number, version: number) =>
    portalRequest<PortalShareDto>(
      `/subjects/${linkId}/shares/${shareId}/approve`,
      { method: "POST", body: { version, approved: true } },
    ),
  revoke: (linkId: number, shareId: number, version: number) =>
    portalRequest<PortalShareDto>(
      `/subjects/${linkId}/shares/${shareId}/revoke`,
      { method: "POST", body: { version } },
    ),
  payments: async (linkId: number, signal?: AbortSignal) =>
    normalizeResourcePage<PortalPaymentsPageDto>(
      await portalRequest(`/subjects/${linkId}/payments`, { signal }),
    ),
  paymentsPage: async (
    linkId: number,
    signal?: AbortSignal,
    cursor?: number,
  ) => {
    const page = await portalRequest<unknown>(
      `/subjects/${linkId}/payments?limit=30${cursor ? `&cursor=${cursor}` : ""}`,
      { signal },
    );
    return normalizeResourcePage<PortalPaymentsPageDto>(page);
  },
  file: (id: number, linkId: number, signal?: AbortSignal) =>
    portalRequest<PortalFileDto>(`/files/${id}/status?linkId=${linkId}`, {
      signal,
    }),
  allNotifications: async (
    signal?: AbortSignal,
  ): Promise<PortalNotificationCollectionDto> => {
    const items: PortalNotificationCollectionDto["items"] = [];
    const seen = new Set<number>();
    let cursor: number | undefined;
    while (true) {
      const page = normalizeResourcePage<PortalNotificationCollectionDto>(
        await portalRequest<unknown>(
          `/notifications?limit=100${cursor ? `&cursor=${cursor}` : ""}`,
          { signal },
        ),
      );
      items.push(...page.items);
      if (page.nextCursor === null) return { ...page, items };
      if (seen.has(page.nextCursor))
        throw new PortalApiError(502, "portalLoadError");
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  },
  notifications: async (signal?: AbortSignal, cursor?: number) =>
    normalizeResourcePage<PortalNotificationCollectionDto>(
      await portalRequest<unknown>(
        `/notifications?limit=30${cursor ? `&cursor=${cursor}` : ""}`,
        { signal },
      ),
    ),
  readNotification: (id: number) =>
    portalRequest<{ success: boolean }>(`/notifications/${id}/read`, {
      method: "POST",
    }),
  readAll: () =>
    portalRequest<{ success: boolean }>("/notifications/read-all", {
      method: "POST",
    }),
  removeNotification: (id: number) =>
    portalRequest<{ success: boolean; deletedCount: number }>(`/notifications/${id}`, {
      method: "DELETE",
    }),
  clearNotifications: () =>
    portalRequest<{ success: boolean; deletedCount: number }>("/notifications", {
      method: "DELETE",
    }),
  preferences: (signal?: AbortSignal) =>
    portalRequest<PortalNotificationPreferencesDto>(
      "/notifications/preferences",
      { signal },
    ),
  savePreferences: (body: PortalNotificationPreferencesDto) =>
    portalRequest<PortalNotificationPreferencesDto>(
      "/notifications/preferences",
      {
        method: "PUT",
        body,
      },
    ),
  upload: (
    linkId: number,
    file: File,
    onProgress: (value: number) => void,
    signal: AbortSignal,
  ) =>
    new Promise<PortalFileDto>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const body = new FormData();
      body.set("linkId", String(linkId));
      body.set("file", file);
      xhr.open("POST", "/api/portal/files");
      xhr.withCredentials = true;
      xhr.timeout = 120_000;
      xhr.setRequestHeader("X-Portal-CSRF", uploadCsrf);
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress(Math.round((event.loaded * 100) / event.total));
      };
      const stop = () => xhr.abort();
      signal.addEventListener("abort", stop, { once: true });
      const finish = () => signal.removeEventListener("abort", stop);
      xhr.onload = () => {
        finish();
        let result;
        try {
          result = JSON.parse(xhr.responseText);
        } catch {
          reject(new PortalApiError(xhr.status, "portalUploadError"));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300)
          resolve(result as PortalFileDto);
        else {
          notifyPortalAccessError(
            new PortalApiError(
              xhr.status,
              result.code ?? result.error ?? "portalUploadError",
            ),
          );
          reject(
            new PortalApiError(
              xhr.status,
              result.code ?? result.error ?? "portalUploadError",
            ),
          );
        }
      };
      xhr.onerror = xhr.ontimeout = () => {
        finish();
        reject(new PortalApiError(0, "portalOffline"));
      };
      xhr.onabort = () => {
        finish();
        reject(new DOMException("Upload aborted", "AbortError"));
      };
      if (signal.aborted) {
        finish();
        reject(new DOMException("Upload aborted", "AbortError"));
      } else xhr.send(body);
    }),
  publicProject: async (
    token: string,
    signal?: AbortSignal,
  ): Promise<PortalPublicProjectDto> => {
    const response = await fetch(
      `/api/public/portfolio/${encodeURIComponent(token)}`,
      { credentials: "omit", cache: "no-store", signal },
    );
    if (!response.ok)
      throw new PortalApiError(
        response.status,
        "portalPublicPortfolioUnavailable",
      );
    return response.json();
  },
};
