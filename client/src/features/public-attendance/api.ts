import type { PublicAttendanceGroup, PublicAttendanceMark, PublicAttendanceRoster, PublicAttendanceSession } from '@shared/contracts/public-attendance';

export class PublicAttendanceApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

const base = '/api/public/attendance';
const request = async <T>(path: string, options: { method?: string; body?: unknown; csrfToken?: string; signal?: AbortSignal } = {}): Promise<T> => {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.csrfToken ? { 'X-Attendance-CSRF': options.csrfToken } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PublicAttendanceApiError(response.status, typeof body.error === 'string' ? body.error : 'publicAttendanceSaveFailed');
  return body as T;
};

export const publicAttendanceApi = {
  session: (signal?: AbortSignal) => request<PublicAttendanceSession>('/session', { signal }),
  open: (password: string) => request<PublicAttendanceSession>('/access', { method: 'POST', body: { password } }),
  close: (csrfToken: string) => request<{ ok: boolean }>('/exit', { method: 'POST', csrfToken }),
  groups: (signal?: AbortSignal) => request<{ groups: PublicAttendanceGroup[] }>('/groups', { signal }),
  roster: (lessonId: number, signal?: AbortSignal) => request<PublicAttendanceRoster>(`/lessons/${lessonId}`, { signal }),
  mark: (lessonId: number, input: PublicAttendanceMark, csrfToken: string) => request<PublicAttendanceRoster>(`/lessons/${lessonId}/attendance`, { method: 'PATCH', body: input, csrfToken }),
};
