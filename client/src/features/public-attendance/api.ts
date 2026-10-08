import type {
  PublicAttendanceBulkMark, PublicAttendanceGroup, PublicAttendanceMark, PublicAttendanceRoster, PublicAttendanceSession,
} from '@shared/contracts/public-attendance';

export class PublicAttendanceApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

/*
  A request that never reached the server is reported as status 0. The page
  tells it apart from a refusal: a dropped connection in a hallway is retried on
  its own, while a refusal needs the visitor to look at the list again.
*/
export const isAttendanceOffline = (error: unknown) => error instanceof PublicAttendanceApiError && error.status === 0;

const base = '/api/public/attendance';
// A request that hangs in a dead spot counts as no connection, so a write is parked and retried instead of spinning forever.
const WRITE_TIMEOUT_MS = 12_000;
const READ_TIMEOUT_MS = 15_000;
const offline = () => new PublicAttendanceApiError(0, 'publicAttendanceOffline');

const request = async <T>(path: string, options: { method?: string; body?: unknown; csrfToken?: string; signal?: AbortSignal } = {}): Promise<T> => {
  const method = options.method ?? 'GET';
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });
  // The caller's own abort is passed on untouched; only the timeout turns into "no connection".
  const fail = (error: unknown): never => {
    if (timedOut) throw offline();
    if (options.signal?.aborted || (error as Error)?.name === 'AbortError') throw error;
    throw offline();
  };
  try {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.csrfToken ? { 'X-Attendance-CSRF': options.csrfToken } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (error) {
      return fail(error);
    }
    let body: { error?: unknown };
    try {
      body = await response.json();
    } catch (error) {
      if (timedOut || options.signal?.aborted) return fail(error);
      body = {};
    }
    if (!response.ok) {
      // The password limiter answers with a generic code shared with the rest of the
      // server; an empty code lets each caller fall back to the message for its own action.
      const code = response.status === 429 ? 'publicAttendanceTooManyAttempts' : typeof body.error === 'string' ? body.error : '';
      throw new PublicAttendanceApiError(response.status, code);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
};

export const publicAttendanceApi = {
  session: (signal?: AbortSignal) => request<PublicAttendanceSession>('/session', { signal }),
  open: (password: string) => request<PublicAttendanceSession>('/access', { method: 'POST', body: { password } }),
  close: (csrfToken: string) => request<{ ok: boolean }>('/exit', { method: 'POST', csrfToken }),
  groups: (signal?: AbortSignal) => request<{ groups: PublicAttendanceGroup[] }>('/groups', { signal }),
  roster: (lessonId: number, signal?: AbortSignal) => request<PublicAttendanceRoster>(`/lessons/${lessonId}`, { signal }),
  mark: (lessonId: number, input: PublicAttendanceMark, csrfToken: string) => request<PublicAttendanceRoster>(`/lessons/${lessonId}/attendance`, { method: 'PATCH', body: input, csrfToken }),
  markMany: (lessonId: number, input: PublicAttendanceBulkMark, csrfToken: string) => request<PublicAttendanceRoster>(`/lessons/${lessonId}/attendance/bulk`, { method: 'PATCH', body: input, csrfToken }),
};
