import type { PublicAttendanceMarkedStatus } from '@shared/contracts/public-attendance';

/** The previous format did not retain whether a mark was a bulk fill or a correction. */
export const attendanceStorageKey = 'pa-unsaved-marks-v1';
export const attendanceStoragePrefix = 'pa-unsaved-marks-v2:';
export const attendanceStorageLeaseMs = 30_000;
const STORED_FOR_MS = 12 * 60 * 60 * 1000;

export type StoredAttendanceRequest = (
  | { kind: 'one'; studentId: number; expectedRevision?: string | null }
  | { kind: 'many'; studentIds: number[] }
) & { id: string; lessonId: number; status: PublicAttendanceMarkedStatus; at: number; attempted: boolean };
interface StoredQueue { version: 2; leaseUntil: number; entries: StoredAttendanceRequest[] }
export interface RecoverableAttendanceQueue { key: string; value: string; entries: StoredAttendanceRequest[] }

export const attendanceRequestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const positiveId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const recent = (at: unknown, now: number) => typeof at === 'number' && Number.isFinite(at) && at <= now + 60_000 && now - at < STORED_FOR_MS;
const isStoredRequest = (value: unknown, now: number): value is StoredAttendanceRequest => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && positiveId(entry.lessonId) && recent(entry.at, now)
    && (entry.status === 'present' || entry.status === 'absent') && typeof entry.attempted === 'boolean'
    && (entry.kind === 'one'
      ? positiveId(entry.studentId) && (entry.expectedRevision === undefined || entry.expectedRevision === null || typeof entry.expectedRevision === 'string')
      : entry.kind === 'many' && Array.isArray(entry.studentIds) && entry.studentIds.length > 0 && entry.studentIds.every(positiveId));
};

/** Each queue writes its own key. A save or sign-out in another tab cannot replace it. */
export const writeAttendanceQueue = (key: string, entries: StoredAttendanceRequest[], leaseUntil: number): boolean => {
  try {
    if (entries.length) window.localStorage.setItem(key, JSON.stringify({ version: 2, leaseUntil, entries } satisfies StoredQueue));
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false; // Private mode or a full disk: the marks still live in this tab.
  }
};

export const recoverableAttendanceQueues = (ownKey: string, now: number): RecoverableAttendanceQueue[] => {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
    const recovered: RecoverableAttendanceQueue[] = [];
    for (const key of keys) {
      if (key === ownKey || (!key.startsWith(attendanceStoragePrefix) && key !== attendanceStorageKey)) continue;
      const value = storage.getItem(key);
      if (!value) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { continue; }
      if (key === attendanceStorageKey) {
        // Old marks have no reliable revision or operation kind. Recover them as fills;
        // a fresh roster must never grant them permission to replace someone else's mark.
        const entries: StoredAttendanceRequest[] = Array.isArray(parsed) ? parsed.flatMap((item, index) => {
          if (!item || typeof item !== 'object') return [];
          const mark = item as Record<string, unknown>;
          if (!positiveId(mark.lessonId) || !positiveId(mark.studentId) || !recent(mark.at, now)
            || (mark.status !== 'present' && mark.status !== 'absent')) return [];
          return [{ id: `legacy:${index}:${mark.lessonId}:${mark.studentId}:${mark.at}`, kind: 'many' as const,
            lessonId: Number(mark.lessonId), studentIds: [Number(mark.studentId)], status: mark.status,
            at: Number(mark.at), attempted: false }];
        }) : [];
        recovered.push({ key, value, entries });
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const queue = parsed as Partial<StoredQueue>;
      // A tab may be suspended or crash without running cleanup. Its lease then
      // expires, so another signed-in tab can recover the work without waiting for it.
      if (queue.version !== 2 || typeof queue.leaseUntil !== 'number' || !Number.isFinite(queue.leaseUntil)
        || queue.leaseUntil > now || !Array.isArray(queue.entries)) continue;
      recovered.push({ key, value, entries: queue.entries.filter((entry) => isStoredRequest(entry, now)) });
    }
    return recovered;
  } catch { return []; }
};

/** Remove the old copy only after the new copy is durable, and only if its owner has not resumed. */
export const finishAttendanceRecovery = (recovered: RecoverableAttendanceQueue[]) => {
  try {
    for (const source of recovered) {
      if (window.localStorage.getItem(source.key) === source.value) window.localStorage.removeItem(source.key);
    }
  } catch { /* Both copies may remain; revisions and fill-only writes make replay safe. */ }
};
