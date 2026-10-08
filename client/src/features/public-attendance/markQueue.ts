import type { QueryClient } from '@tanstack/react-query';
import type {
  PublicAttendanceGroup, PublicAttendanceMarkedStatus, PublicAttendanceRoster, PublicAttendanceStatus,
} from '@shared/contracts/public-attendance';
import type { TranslationKey } from '@/lib/i18n';
import { publicAttendanceApi, PublicAttendanceApiError } from './api';
import { attendanceErrorKey } from './presentation';
import {
  attendanceRequestId, attendanceStorageKey, attendanceStorageLeaseMs, attendanceStoragePrefix, finishAttendanceRecovery,
  recoverableAttendanceQueues, writeAttendanceQueue, type StoredAttendanceRequest,
} from './markQueueStorage';

export const attendanceGroupsKey = ['public-attendance', 'groups'] as const;
export const attendanceRosterKey = (id?: number) => ['public-attendance', 'roster', id] as const;
export const attendanceMarkKey = (lessonId: number, studentId: number) => `${lessonId}:${studentId}`;
/** Where marks that have not reached the server wait out a closed or discarded tab. */
export { attendanceStorageKey, attendanceStoragePrefix } from './markQueueStorage';

export type AttendanceMarkRequest =
  | { kind: 'one'; lessonId: number; studentId: number; status: PublicAttendanceStatus }
  | { kind: 'many'; lessonId: number; studentIds: number[]; status: PublicAttendanceMarkedStatus };
type Entry = AttendanceMarkRequest & {
  id: string; at: number; attempted: boolean; expectedRevision?: string | null; settle: (error?: unknown) => void;
};

export type AttendanceSaveResult = { ok: true } | { ok: false; error: unknown };
export interface AttendanceFailure {
  lessonId: number; studentId: number; status: PublicAttendanceMarkedStatus; at: number;
  id: string; kind: 'one' | 'many'; expectedRevision?: string | null;
}
export interface AttendanceMarkNotice {
  translationKey: TranslationKey;
  tone: 'error' | 'info';
  retry?: boolean;
  /** The student a conflict is about, so the message can name them. */
  lessonId?: number;
  studentId?: number;
}
export interface AttendanceLessonMarks { pending: number; failed: number }

export interface AttendanceQueueSnapshot {
  /** The status each student is about to have, shown before the server confirms it. */
  overrides: ReadonlyMap<string, PublicAttendanceStatus>;
  failures: ReadonlyMap<string, AttendanceFailure>;
  /** Marks someone else changed while the visitor's own change was on its way; cleared by the next tap on that row. */
  changed: ReadonlySet<string>;
  /** Marks still on their way and marks that failed, per lesson; a lesson with neither is absent. */
  lessons: ReadonlyMap<number, AttendanceLessonMarks>;
  busyLessons: ReadonlySet<number>;
  /** The connection dropped; the queue is holding its marks and retrying on its own. */
  waiting: boolean;
  /** Access ended; the marks wait for the visitor to sign in again. */
  locked: boolean;
  pending: number;
  /** Every mark not on the server yet, in any lesson: on its way or failed. */
  unsaved: number;
  savedAt: number;
}

export interface AttendanceQueueHost {
  csrfToken: () => string;
  onAccessLost: () => void;
  onNotice: (notice: AttendanceMarkNotice) => void;
}

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
const apiStatus = (error: unknown) => error instanceof PublicAttendanceApiError ? error.status : undefined;
// No answer at all, or a gateway that could not reach the server: worth trying again on its own.
const isTransient = (error: unknown) => [0, 502, 503, 504].includes(apiStatus(error) ?? -1);
const isAccessLost = (error: unknown) => [401, 403].includes(apiStatus(error) ?? -1);
const isRefusal = (error: unknown) => [400, 404, 409].includes(apiStatus(error) ?? -1);
const accessExpired = () => new PublicAttendanceApiError(401, 'publicAttendanceAccessExpired');
const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
/* Removing a mark is confirmed in a dialog that waits for the answer and reports
   its own failure, so it is never parked, stored, or held for a later session. */
const isClear = (entry: AttendanceMarkRequest) => entry.kind === 'one' && entry.status === null;

/*
  Marks are saved one request at a time, in the order they were made, while the
  page shows each one immediately. The server serialises attendance writes
  anyway, so a single lane costs nothing — and it buys guarantees a parallel
  burst cannot give:

  - every response is a snapshot that already contains every earlier write, so
    it can replace the cached roster wholesale;
  - each request carries the revision returned by the one before it, so a quick
    "present → absent" on one student is never refused as someone else's edit;
  - a dropped connection pauses the lane instead of failing a dozen taps: the
    marks stay on screen and go out when the network comes back. The server
    treats a repeated value as already saved, so a retry after a lost response
    is harmless;
  - expired access locks the lane instead of emptying it, and every unsent mark
    is kept in local storage, so neither a new sign-in nor a closed tab loses
    work.
*/
export class AttendanceMarkQueue {
  private readonly client: QueryClient;
  private readonly host: AttendanceQueueHost;
  private entries: Entry[] = [];
  private sending = false;
  private locked = false;
  private readonly epochs = new Map<number, number>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures: ReadonlyMap<string, AttendanceFailure> = new Map();
  private changed: ReadonlySet<string> = new Set();
  /** The visitor signed out and agreed to lose these; whatever the server answers no longer matters. */
  private readonly discarded = new WeakSet<Entry>();
  private waiting = false;
  /** Writes that ended unsaved since the queue last became busy: "saved" is only said after a clean run. */
  private errors = 0;
  private savedAt = 0;
  private readonly storageKey = `${attendanceStoragePrefix}${attendanceRequestId()}`;
  private storageTimer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private sessionConfirmed = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: AttendanceQueueSnapshot;

  constructor(client: QueryClient, host: AttendanceQueueHost) {
    this.client = client;
    this.host = host;
    this.recover();
    this.snapshot = this.computeSnapshot();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  /** Keep this tab's ownership alive and recover queues left by closed or suspended tabs. */
  connect() {
    this.disposed = false;
    clearInterval(this.storageTimer);
    window.addEventListener('storage', this.onStorage);
    this.storageTimer = setInterval(this.syncStorage, attendanceStorageLeaseMs / 3);
    this.syncStorage();
  }

  private syncStorage = () => {
    if (this.disposed) return;
    if (this.recover()) {
      this.emit();
      if (!this.locked) void this.pump();
    } else this.persist();
  };

  private onStorage = (event: StorageEvent) => {
    if (this.disposed || (event.key && !event.key.startsWith(attendanceStoragePrefix) && event.key !== attendanceStorageKey)) return;
    // Do not renew our lease for another tab's heartbeat: writing back to every
    // storage event would make the two tabs continuously trigger each other.
    if (this.recover()) {
      this.emit();
      if (!this.locked) void this.pump();
    }
  };

  /** Changes whenever a write for this lesson starts or ends, so a roster read that overlapped one can be discarded. */
  epochOf(lessonId: number) { return this.epochs.get(lessonId) ?? 0; }

  enqueue(request: AttendanceMarkRequest): Promise<AttendanceSaveResult> {
    return new Promise((resolve) => {
      const student = request.kind === 'one'
        ? this.client.getQueryData<PublicAttendanceRoster>(attendanceRosterKey(request.lessonId))?.students.find((item) => item.id === request.studentId)
        : undefined;
      const entry = { ...request, id: attendanceRequestId(), at: Date.now(), attempted: false,
        ...(request.kind === 'one' ? { expectedRevision: student?.revision ?? null } : {}),
        settle: (error?: unknown) => resolve(error === undefined ? { ok: true } : { ok: false, error }) } as Entry;
      if (isClear(entry) && (this.locked || this.waiting || browserOffline())) {
        entry.settle(this.locked ? accessExpired() : new PublicAttendanceApiError(0, 'publicAttendanceOffline'));
        return;
      }
      if (!this.entries.length) this.errors = 0;
      if (entry.kind === 'many') entry.studentIds = [...entry.studentIds];
      else {
        this.supersede(entry.lessonId, entry.studentId);
        // A new choice for one student replaces whatever failed or was changed elsewhere for them; a bundle never does.
        this.forgetFailures(entry.lessonId, [entry.studentId]);
        this.forgetChanged(entry.lessonId, entry.studentId);
      }
      // A clear goes after already attempted writes: their result must be resolved first.
      if (isClear(entry)) {
        const firstUnsent = this.entries.findIndex((item) => !item.attempted);
        this.entries.splice(firstUnsent < 0 ? this.entries.length : Math.max(this.sending ? 1 : 0, firstUnsent), 0, entry);
      } else this.entries.push(entry);
      this.emit();
      void this.pump();
    });
  }

  retry(lessonId: number, studentId: number) {
    const failure = this.failures.get(attendanceMarkKey(lessonId, studentId));
    if (failure && !this.queued(lessonId, studentId)) this.retryFailure(failure);
  }

  private retryFailure(failure: AttendanceFailure) {
    this.forgetFailures(failure.lessonId, [failure.studentId]);
    this.entries.push({ id: failure.id, at: failure.at, attempted: true, lessonId: failure.lessonId, status: failure.status,
      ...(failure.kind === 'many' ? { kind: 'many', studentIds: [failure.studentId] } : {
        kind: 'one', studentId: failure.studentId, expectedRevision: failure.expectedRevision,
      }), settle: () => undefined });
    this.emit();
    void this.pump();
  }

  /** Sends the failed marks again — only those of one lesson when `lessonId` is given. */
  retryAll(lessonId?: number) {
    const bundles = new Map<string, AttendanceFailure[]>();
    const singles: AttendanceFailure[] = [];
    for (const failure of this.failures.values()) {
      if ((lessonId !== undefined && failure.lessonId !== lessonId) || this.queued(failure.lessonId, failure.studentId)) continue;
      // A bundle only fills marks the server still has empty; a correction goes alone, carrying its revision.
      if (failure.kind === 'one') {
        singles.push(failure);
        continue;
      }
      const bundle = `${failure.lessonId}:${failure.status}`;
      bundles.set(bundle, [...(bundles.get(bundle) ?? []), failure]);
    }
    for (const bundle of bundles.values()) {
      if (bundle.length < 2) {
        singles.push(...bundle);
        continue;
      }
      const studentIds = bundle.map((item) => item.studentId);
      // The rows go back to "on its way" while the bundle is out; a second failure records them again.
      this.forgetFailures(bundle[0].lessonId, studentIds);
      void this.enqueue({ kind: 'many', lessonId: bundle[0].lessonId, status: bundle[0].status, studentIds });
    }
    singles.forEach((item) => this.retryFailure(item));
  }

  /** The browser says the connection is back, or the page is visible again: stop waiting for the back-off timer. */
  resume() {
    this.syncStorage();
    if (this.waiting && !this.sending) void this.pump();
  }

  /** Access ended: every mark waits for the visitor to sign in again. */
  lock() {
    this.sessionConfirmed = false;
    if (this.locked) return;
    this.locked = true;
    clearTimeout(this.timer);
    const error = accessExpired();
    this.entries = this.entries.filter((entry, index) => {
      if (!isClear(entry) || (this.sending && index === 0)) return true;
      entry.settle(error);
      return false;
    });
    this.emit();
  }

  unlock() {
    this.sessionConfirmed = true;
    if (!this.locked) return;
    this.locked = false;
    this.attempt = 0;
    this.emit();
    void this.pump();
  }

  /** The visitor signed out and agreed to lose what was not saved. */
  reset() {
    clearTimeout(this.timer);
    const inFlight = this.sending ? this.entries[0] : undefined;
    if (inFlight) this.discarded.add(inFlight);
    const dropped = inFlight ? this.entries.slice(1) : this.entries;
    this.entries = inFlight ? [inFlight] : [];
    dropped.forEach((entry) => entry.settle(accessExpired()));
    this.failures = new Map();
    this.changed = new Set();
    this.waiting = false;
    this.locked = false;
    this.sessionConfirmed = false;
    this.attempt = 0;
    this.emit();
  }

  dispose() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    clearInterval(this.storageTimer);
    window.removeEventListener('storage', this.onStorage);
    writeAttendanceQueue(this.storageKey, this.serialize(), 0);
    this.disposed = true;
  }

  // A newer tap on the same student replaces anything of theirs still waiting in line.
  private supersede(lessonId: number, studentId: number) {
    for (let index = this.entries.length - 1; index >= (this.sending ? 1 : 0); index -= 1) {
      const item = this.entries[index];
      if (item.lessonId !== lessonId) continue;
      // A sent request may have committed even when its response was lost. Resolve
      // it first, so its confirmed revision can become the next correction's base.
      if (item.attempted) continue;
      if (item.kind === 'one' && item.studentId === studentId) {
        this.entries.splice(index, 1);
        item.settle();
      } else if (item.kind === 'many' && item.studentIds.includes(studentId)) {
        item.studentIds = item.studentIds.filter((id) => id !== studentId);
        if (!item.studentIds.length) {
          this.entries.splice(index, 1);
          item.settle();
        }
      }
    }
  }

  private students(entry: AttendanceMarkRequest) {
    return entry.kind === 'one' ? [entry.studentId] : entry.studentIds;
  }

  private queued(lessonId: number, studentId: number) {
    return this.entries.some((entry) => entry.lessonId === lessonId && !this.discarded.has(entry) && this.students(entry).includes(studentId));
  }

  private forgetFailures(lessonId: number, studentIds: number[]) {
    const keys = studentIds.map((studentId) => attendanceMarkKey(lessonId, studentId));
    if (!keys.some((key) => this.failures.has(key))) return;
    const next = new Map(this.failures);
    keys.forEach((key) => next.delete(key));
    this.failures = next;
  }

  private forgetChanged(lessonId: number, studentId: number) {
    const key = attendanceMarkKey(lessonId, studentId);
    if (!this.changed.has(key)) return;
    const next = new Set(this.changed);
    next.delete(key);
    this.changed = next;
  }

  /** Records the failure of every student in the request who has no newer choice in line. Returns whether any was recorded. */
  private fail(entry: Entry) {
    const { status } = entry;
    if (status === null) return false;
    const next = new Map(this.failures);
    let recorded = false;
    for (const studentId of this.students(entry)) {
      if (this.queued(entry.lessonId, studentId)) continue;
      next.set(attendanceMarkKey(entry.lessonId, studentId), {
        lessonId: entry.lessonId, studentId, status, at: entry.at, id: `${entry.id}:${studentId}`, kind: entry.kind,
        ...(entry.kind === 'one' ? { expectedRevision: entry.expectedRevision } : {}),
      });
      recorded = true;
    }
    if (recorded) this.failures = next;
    return recorded;
  }

  private bump(lessonId: number) { this.epochs.set(lessonId, this.epochOf(lessonId) + 1); }

  /*
    A mark restored from storage, or held over a new sign-in, may belong to a
    lesson nobody has opened in this tab: read its list first. Persisted singles
    retain their original revision; bundles only fill students still unmarked.
  */
  private async loadRoster(lessonId: number) {
    if (this.client.getQueryData(attendanceRosterKey(lessonId))) return;
    await this.client.fetchQuery({ queryKey: attendanceRosterKey(lessonId), queryFn: ({ signal }) => publicAttendanceApi.roster(lessonId, signal) });
  }

  private async send(entry: Entry) {
    const roster = this.client.getQueryData<PublicAttendanceRoster>(attendanceRosterKey(entry.lessonId));
    const find = (studentId: number) => roster?.students.find((student) => student.id === studentId);
    if (entry.kind === 'one') {
      const student = find(entry.studentId);
      // An attempted request must be acknowledged by the server even if this
      // tab's cached roster happens to show the requested value.
      if (!entry.attempted && student && student.status === entry.status) return null;
      if (entry.expectedRevision === undefined) entry.expectedRevision = student?.revision ?? null;
      entry.attempted = true;
      this.persist();
      return publicAttendanceApi.mark(entry.lessonId, {
        studentId: entry.studentId, status: entry.status, expectedRevision: entry.expectedRevision,
        ...(entry.status === null ? { clearConfirmed: true } : {}),
      }, this.host.csrfToken());
    }
    const studentIds = entry.attempted ? entry.studentIds
      : entry.studentIds.filter((studentId) => (find(studentId)?.status ?? null) === null);
    entry.attempted = true;
    this.persist();
    return studentIds.length ? publicAttendanceApi.markMany(entry.lessonId, { studentIds, status: entry.status }, this.host.csrfToken()) : null;
  }

  /** Only an acknowledged preceding write can advance the base of a queued correction. */
  private rebaseFollowing(entry: Entry, roster: PublicAttendanceRoster) {
    for (const studentId of this.students(entry)) {
      const student = roster.students.find((item) => item.id === studentId);
      if (!student || student.status !== entry.status) continue;
      for (const next of this.entries.slice(1)) {
        if (next.kind === 'one' && !next.attempted && next.lessonId === entry.lessonId && next.studentId === studentId) {
          next.expectedRevision = student.revision;
        }
      }
    }
  }

  /*
    Puts a write's answer in place: the roster wholesale, and its lesson inside
    the cached list of streams, so the lesson cells follow without a re-read.
    Completing a lesson can complete later ones on the server too, so a fully
    marked answer asks for the list of streams to be read again.
  */
  private apply(roster: PublicAttendanceRoster) {
    this.client.setQueryData(attendanceRosterKey(roster.lesson.id), roster);
    this.client.setQueryData<{ groups: PublicAttendanceGroup[] }>(attendanceGroupsKey, (data) => data && {
      groups: data.groups.map((group) => group.id !== roster.lesson.groupId ? group : {
        ...group, lessons: group.lessons.map((lesson) => lesson.id === roster.lesson.id ? roster.lesson : lesson),
      }),
    });
    return roster.lesson.fullyMarked;
  }

  private async pump() {
    if (this.sending || this.locked || this.disposed) return;
    clearTimeout(this.timer);
    while (this.entries.length && !this.locked && !this.disposed) {
      const entry = this.entries[0];
      let rereadRoster = false;
      let rereadGroups = false;
      this.sending = true;
      this.bump(entry.lessonId);
      this.emit();
      try {
        // A roster read already in flight may predate this write; drop it rather than let it land afterwards.
        await this.client.cancelQueries({ queryKey: attendanceRosterKey(entry.lessonId), exact: true });
        await this.loadRoster(entry.lessonId);
        const roster = await this.send(entry);
        if (roster && !this.discarded.has(entry) && !this.disposed) {
          this.rebaseFollowing(entry, roster);
          rereadGroups = this.apply(roster);
        }
        this.attempt = 0;
        this.waiting = false;
        this.entries.shift();
        this.forgetFailures(entry.lessonId, this.students(entry));
        entry.settle();
      } catch (error) {
        const kept = !this.discarded.has(entry) && !isClear(entry);
        if (kept && isTransient(error) && !this.disposed) {
          // No connection, or the server is briefly out of reach: hold the lane and try again shortly.
          this.waiting = true;
          this.timer = setTimeout(() => void this.pump(), RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)]);
          this.attempt += 1;
          return;
        }
        if (kept && isAccessLost(error) && !this.disposed) {
          // Access ran out: this mark and everything behind it wait for the visitor to sign in again.
          this.waiting = false;
          this.attempt = 0;
          this.lock();
          this.host.onAccessLost();
          return;
        }
        this.entries.shift();
        this.waiting = false;
        this.attempt = 0;
        if (!this.discarded.has(entry) && !this.disposed) {
          this.errors += 1;
          if (isAccessLost(error)) {
            // A clear is answered in its dialog, so it is dropped here rather than held; nothing is in flight any more.
            entry.settle(error);
            this.sending = false;
            this.lock();
            this.host.onAccessLost();
            return;
          }
          if (isRefusal(error)) {
            // Someone else changed the list, or the lesson cannot take marks: show the server's version.
            rereadRoster = true;
            rereadGroups = true;
            const conflict = entry.kind === 'one' && error instanceof PublicAttendanceApiError && error.code === 'publicAttendanceConflict';
            if (conflict) {
              const next = new Set(this.changed);
              next.add(attendanceMarkKey(entry.lessonId, entry.studentId));
              this.changed = next;
            }
            this.host.onNotice({
              translationKey: attendanceErrorKey(error, 'save'), tone: 'error',
              ...(conflict ? { lessonId: entry.lessonId, studentId: entry.studentId } : {}),
            });
          } else if (!isClear(entry) && this.fail(entry)) {
            this.host.onNotice({ translationKey: 'publicAttendanceSaveFailed', tone: 'error', retry: true });
          }
        }
        entry.settle(error);
      } finally {
        this.sending = false;
        this.bump(entry.lessonId);
        this.emit();
        // Re-read only once this write has closed, or the overlap guard would throw the fresh list away.
        if (rereadRoster) void this.client.invalidateQueries({ queryKey: attendanceRosterKey(entry.lessonId), exact: true });
        if (rereadGroups) void this.client.invalidateQueries({ queryKey: attendanceGroupsKey });
      }
    }
    if (this.entries.length || this.locked || this.disposed) return;
    if (this.errors === 0) this.savedAt = Date.now();
    this.emit();
  }

  private serialize(): StoredAttendanceRequest[] {
    const marks: StoredAttendanceRequest[] = [];
    for (const failure of this.failures.values()) {
      marks.push({ id: failure.id, lessonId: failure.lessonId, status: failure.status, at: failure.at, attempted: true,
        ...(failure.kind === 'many' ? { kind: 'many', studentIds: [failure.studentId] } : {
          kind: 'one', studentId: failure.studentId, expectedRevision: failure.expectedRevision,
        }) });
    }
    for (const entry of this.entries) {
      const { status } = entry;
      if (status === null || this.discarded.has(entry)) continue;
      marks.push({ id: entry.id, lessonId: entry.lessonId, status, at: entry.at, attempted: entry.attempted,
        ...(entry.kind === 'many' ? { kind: 'many', studentIds: [...entry.studentIds] } : {
          kind: 'one', studentId: entry.studentId, expectedRevision: entry.expectedRevision,
        }) });
    }
    return marks;
  }

  private persist() {
    if (this.disposed) return;
    writeAttendanceQueue(this.storageKey, this.serialize(), Date.now() + attendanceStorageLeaseMs);
  }

  private recover() {
    const recovered = recoverableAttendanceQueues(this.storageKey, Date.now());
    if (!recovered.length) return false;
    const known = new Set(this.serialize().map((entry) => entry.id));
    let added = false;
    for (const source of recovered) {
      for (const entry of source.entries) {
        if (known.has(entry.id)) continue;
        known.add(entry.id);
        this.entries.push({ ...entry, ...(entry.kind === 'one' ? { expectedRevision: entry.expectedRevision ?? null } : {}), settle: () => undefined });
        added = true;
      }
    }
    // Keep each stored queue's operation order and append to the current lane.
    // Wall-clock changes must not put a correction before its predecessor, and
    // recovery during a write must not displace the entry pump will remove.
    if (added && !this.sessionConfirmed) this.locked = true;
    if (writeAttendanceQueue(this.storageKey, this.serialize(), Date.now() + attendanceStorageLeaseMs)) {
      finishAttendanceRecovery(recovered);
    }
    return added;
  }

  private computeSnapshot(): AttendanceQueueSnapshot {
    const overrides = new Map<string, PublicAttendanceStatus>();
    const busyLessons = new Set<number>();
    const lessons = new Map<number, AttendanceLessonMarks>();
    const tally = (lessonId: number) => {
      const counts = lessons.get(lessonId) ?? { pending: 0, failed: 0 };
      lessons.set(lessonId, counts);
      return counts;
    };
    for (const entry of this.entries) {
      if (this.discarded.has(entry)) continue;
      busyLessons.add(entry.lessonId);
      for (const studentId of this.students(entry)) {
        const key = attendanceMarkKey(entry.lessonId, studentId);
        if (!overrides.has(key)) tally(entry.lessonId).pending += 1;
        overrides.set(key, entry.status);
      }
    }
    for (const failure of this.failures.values()) tally(failure.lessonId).failed += 1;
    let unsaved = overrides.size;
    for (const key of this.failures.keys()) if (!overrides.has(key)) unsaved += 1;
    return {
      overrides, failures: this.failures, changed: this.changed, lessons, busyLessons,
      waiting: this.waiting, locked: this.locked, pending: overrides.size, unsaved, savedAt: this.savedAt,
    };
  }

  private emit() {
    this.snapshot = this.computeSnapshot();
    this.persist();
    this.listeners.forEach((listener) => listener());
  }
}
