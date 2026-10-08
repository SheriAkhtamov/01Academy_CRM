// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAttendanceMark, PublicAttendanceRoster } from '../shared/contracts/public-attendance';
import {
  AttendanceMarkQueue, attendanceMarkKey, attendanceRosterKey, attendanceStorageKey, attendanceStoragePrefix,
} from '../client/src/features/public-attendance/markQueue';
import { attendanceStorageLeaseMs } from '../client/src/features/public-attendance/markQueueStorage';
import { publicAttendanceApi, PublicAttendanceApiError } from '../client/src/features/public-attendance/api';

const fixture = (): PublicAttendanceRoster => ({
  lesson: { id: 10, groupId: 1, number: 1, scheduledAt: '2026-10-01T05:00:00Z', durationMinutes: 60, status: 'scheduled', canMark: true, fullyMarked: false },
  students: [100, 101].map((id) => ({ id, name: `Student ${id}`, organization: null, status: null, revision: null })),
});
let server: PublicAttendanceRoster;
let revision: number;
let clients: QueryClient[];
let queues: AttendanceMarkQueue[];
const flush = async () => { for (let index = 0; index < 80; index += 1) await Promise.resolve(); };
const durableRequests = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  .filter((key): key is string => Boolean(key?.startsWith(attendanceStoragePrefix)))
  .flatMap((key) => JSON.parse(localStorage.getItem(key)!).entries as Array<{ kind: string; status: string; studentId?: number; studentIds?: number[] }>);
const make = (cached: PublicAttendanceRoster | null = fixture()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  if (cached) client.setQueryData(attendanceRosterKey(10), structuredClone(cached));
  const onNotice = vi.fn();
  const queue = new AttendanceMarkQueue(client, { csrfToken: () => 'csrf', onAccessLost: vi.fn(), onNotice });
  queues.push(queue);
  return { queue, client, onNotice };
};
const commit = (input: PublicAttendanceMark) => {
  const student = server.students.find((item) => item.id === input.studentId)!;
  if (student.status !== input.status) {
    if (student.revision !== input.expectedRevision) throw new PublicAttendanceApiError(409, 'publicAttendanceConflict');
    student.status = input.status;
    student.revision = input.status === null ? null : `revision-${++revision}`;
  }
  return structuredClone(server);
};

beforeEach(() => {
  localStorage.clear();
  server = fixture();
  revision = 0;
  clients = [];
  queues = [];
  vi.spyOn(publicAttendanceApi, 'roster').mockImplementation(async () => structuredClone(server));
  vi.spyOn(publicAttendanceApi, 'mark').mockImplementation(async (_lessonId, input) => commit(input));
  vi.spyOn(publicAttendanceApi, 'markMany').mockImplementation(async (_lessonId, input) => {
    for (const student of server.students) {
      if (input.studentIds.includes(student.id) && student.status === null) {
        student.status = input.status;
        student.revision = `revision-${++revision}`;
      }
    }
    return structuredClone(server);
  });
});
afterEach(() => {
  queues.forEach((queue) => queue.dispose());
  clients.forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe('public attendance durable writes', () => {
  it('restores a bulk fill without overwriting a mark made by another visitor', async () => {
    vi.mocked(publicAttendanceApi.markMany).mockRejectedValueOnce(new PublicAttendanceApiError(0, 'publicAttendanceOffline'));
    const old = make();
    void old.queue.enqueue({ kind: 'many', lessonId: 10, studentIds: [100, 101], status: 'present' });
    await flush();
    expect(old.queue.getSnapshot().waiting).toBe(true);
    old.queue.dispose();
    server.students[0] = { ...server.students[0], status: 'absent', revision: 'other-visitor' };
    const restored = make(null);
    restored.queue.unlock();
    await flush();
    expect(server.students.map((student) => student.status)).toEqual(['absent', 'present']);
    expect(publicAttendanceApi.mark).not.toHaveBeenCalled();
    expect(publicAttendanceApi.markMany).toHaveBeenLastCalledWith(10, { studentIds: [100, 101], status: 'present' }, 'csrf');
    expect(restored.queue.getSnapshot().unsaved).toBe(0);
    expect(durableRequests()).toHaveLength(0);
  });

  it('restores the original revision of an individual correction rather than borrowing a foreign revision', async () => {
    const initial = fixture();
    initial.students[0] = { ...initial.students[0], status: 'present', revision: 'original' };
    server = structuredClone(initial);
    const old = make(initial);
    old.queue.lock();
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'absent' });
    old.queue.dispose();
    server.students[0] = { ...server.students[0], status: 'present', revision: 'foreign-newer' };
    const restored = make(null);
    restored.queue.unlock();
    await flush();
    expect(publicAttendanceApi.mark).toHaveBeenCalledWith(10, { studentId: 100, status: 'absent', expectedRevision: 'original' }, 'csrf');
    expect(server.students[0]).toMatchObject({ status: 'present', revision: 'foreign-newer' });
    expect(restored.queue.getSnapshot().changed.has(attendanceMarkKey(10, 100))).toBe(true);
  });

  it('acknowledges a lost response before saving the newer correction against its own revision', async () => {
    vi.mocked(publicAttendanceApi.mark).mockImplementationOnce(async (_lessonId, input) => {
      commit(input);
      throw new PublicAttendanceApiError(0, 'publicAttendanceOffline');
    });
    const { queue, onNotice } = make();
    const first = queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    await flush();
    expect(server.students[0].status).toBe('present');
    expect(queue.getSnapshot().waiting).toBe(true);
    const correction = queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'absent' });
    await flush();
    expect(await first).toEqual({ ok: true });
    expect(await correction).toEqual({ ok: true });
    expect(publicAttendanceApi.mark).toHaveBeenCalledTimes(3);
    expect(vi.mocked(publicAttendanceApi.mark).mock.calls.map(([, input]) => [input.status, input.expectedRevision])).toEqual([
      ['present', null], ['present', null], ['absent', 'revision-1'],
    ]);
    expect(server.students[0].status).toBe('absent');
    expect(queue.getSnapshot().unsaved).toBe(0);
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('retains both an ambiguous write and its correction when the tab closes', async () => {
    vi.mocked(publicAttendanceApi.mark).mockImplementationOnce(async (_lessonId, input) => {
      commit(input);
      throw new PublicAttendanceApiError(0, 'publicAttendanceOffline');
    });
    const old = make();
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    await flush();
    old.queue.lock();
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'absent' });
    expect(durableRequests().map((entry) => entry.status)).toEqual(['present', 'absent']);
    old.queue.dispose();
    const restored = make(null);
    restored.queue.unlock();
    await flush();
    expect(server.students[0].status).toBe('absent');
    expect(publicAttendanceApi.mark).toHaveBeenLastCalledWith(10, { studentId: 100, status: 'absent', expectedRevision: 'revision-1' }, 'csrf');
    expect(restored.queue.getSnapshot().unsaved).toBe(0);
  });

  it('still protects a foreign change while reconciling a lost response', async () => {
    vi.mocked(publicAttendanceApi.mark).mockImplementationOnce(async (_lessonId, input) => {
      commit(input);
      throw new PublicAttendanceApiError(0, 'publicAttendanceOffline');
    });
    const { queue } = make();
    void queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    await flush();
    server.students[0] = { ...server.students[0], status: 'absent', revision: 'foreign-after-own' };
    const correction = queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    await flush();
    expect((await correction).ok).toBe(false);
    expect(server.students[0]).toMatchObject({ status: 'absent', revision: 'foreign-after-own' });
    expect(queue.getSnapshot().changed.has(attendanceMarkKey(10, 100))).toBe(true);
  });

  it('preserves the write-before-correction order when the device clock moves backwards', async () => {
    vi.useFakeTimers();
    vi.mocked(publicAttendanceApi.mark).mockImplementationOnce(async (_lessonId, input) => {
      commit(input);
      throw new PublicAttendanceApiError(0, 'publicAttendanceOffline');
    });
    const old = make();
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    await flush();
    old.queue.lock();
    vi.setSystemTime(Date.now() - 1_000);
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'absent' });
    old.queue.dispose();
    const restored = make(null);
    restored.queue.unlock();
    await flush();
    expect(server.students[0].status).toBe('absent');
    expect(vi.mocked(publicAttendanceApi.mark).mock.calls.map(([, input]) => input.status)).toEqual(['present', 'present', 'absent']);
    expect(restored.queue.getSnapshot().unsaved).toBe(0);
  });

  it('keeps fill-only semantics for a failed bulk row retried separately', async () => {
    vi.mocked(publicAttendanceApi.markMany).mockRejectedValueOnce(new PublicAttendanceApiError(500, 'publicAttendanceSaveFailed'));
    const { queue } = make();
    const result = queue.enqueue({ kind: 'many', lessonId: 10, studentIds: [100, 101], status: 'present' });
    await flush();
    expect((await result).ok).toBe(false);
    server.students[0] = { ...server.students[0], status: 'absent', revision: 'foreign' };
    queue.retry(10, 100);
    await flush();
    expect(server.students[0]).toMatchObject({ status: 'absent', revision: 'foreign' });
    expect(publicAttendanceApi.mark).not.toHaveBeenCalled();
    expect(queue.getSnapshot().failures.has(attendanceMarkKey(10, 101))).toBe(true);
  });

  it('recovers the older format conservatively as fills when it has no original revisions', async () => {
    localStorage.setItem(attendanceStorageKey, JSON.stringify([{ lessonId: 10, studentId: 100, status: 'present', at: Date.now() }]));
    server.students[0] = { ...server.students[0], status: 'absent', revision: 'foreign' };
    const { queue } = make(null);
    queue.unlock();
    await flush();
    expect(server.students[0].status).toBe('absent');
    expect(publicAttendanceApi.mark).not.toHaveBeenCalled();
    expect(localStorage.getItem(attendanceStorageKey)).toBeNull();
    expect(queue.getSnapshot().unsaved).toBe(0);
  });
});

describe('public attendance queues in multiple tabs', () => {
  it('keeps both active tabs durable and limits reset to the current tab', async () => {
    const a = make();
    const b = make();
    a.queue.lock(); b.queue.lock();
    void a.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    void b.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 101, status: 'absent' });
    expect(durableRequests().map((entry) => entry.studentId).sort()).toEqual([100, 101]);
    a.queue.reset();
    expect(b.queue.getSnapshot().unsaved).toBe(1);
    expect(durableRequests().map((entry) => entry.studentId)).toEqual([101]);
    b.queue.dispose();
    const nextVisit = make(null);
    nextVisit.queue.unlock();
    await flush();
    expect(server.students.map((student) => student.status)).toEqual([null, 'absent']);
    expect(nextVisit.queue.getSnapshot().unsaved).toBe(0);
  });

  it('does not adopt another tab while that tab still owns its work', () => {
    const a = make();
    a.queue.lock();
    void a.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    const b = make();
    b.queue.unlock(); b.queue.resume();
    expect(b.queue.getSnapshot().unsaved).toBe(0);
    expect(a.queue.getSnapshot().unsaved).toBe(1);
    expect(publicAttendanceApi.mark).not.toHaveBeenCalled();
    b.queue.reset();
    expect(durableRequests().map((entry) => entry.studentId)).toEqual([100]);
  });

  it('recovers a crashed tab after its lease expires without erasing another pending mark', async () => {
    vi.useFakeTimers();
    const a = make();
    a.queue.lock();
    void a.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    // A crashed tab does not run dispose or continue its ownership heartbeat.
    const b = make();
    b.queue.unlock();
    b.queue.connect();
    expect(b.queue.getSnapshot().unsaved).toBe(0);
    await vi.advanceTimersByTimeAsync(attendanceStorageLeaseMs + 1);
    await flush();
    expect(server.students[0].status).toBe('present');
    expect(b.queue.getSnapshot().unsaved).toBe(0);
    expect(durableRequests()).toHaveLength(0);
  });

  it('renews ownership while a tab remains open with locked marks', async () => {
    vi.useFakeTimers();
    const a = make();
    a.queue.lock(); a.queue.connect();
    void a.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    await vi.advanceTimersByTimeAsync(attendanceStorageLeaseMs * 3);
    const b = make();
    b.queue.unlock();
    expect(b.queue.getSnapshot().unsaved).toBe(0);
    expect(durableRequests().map((entry) => entry.studentId)).toEqual([100]);
  });

  it('does not echo another active tab’s ownership heartbeat back into storage', () => {
    const a = make();
    a.queue.lock(); a.queue.connect();
    void a.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    const b = make();
    b.queue.lock(); b.queue.connect();
    void b.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 101, status: 'absent' });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const activeKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .find((key) => key?.startsWith(attendanceStoragePrefix))!;
    window.dispatchEvent(new StorageEvent('storage', { key: activeKey }));
    expect(write).not.toHaveBeenCalled();
    expect(durableRequests().map((entry) => entry.studentId).sort()).toEqual([100, 101]);
  });

  it('adopts a closed tab through a storage event without displacing its own request in flight', async () => {
    const old = make();
    old.queue.lock();
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    const active = make();
    active.queue.unlock(); active.queue.connect();
    let release: () => void = () => undefined;
    vi.mocked(publicAttendanceApi.mark).mockImplementationOnce((_id, input) => new Promise((resolve) => {
      release = () => resolve(commit(input));
    }));
    const own = active.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 101, status: 'absent' });
    await flush();
    old.queue.dispose();
    window.dispatchEvent(new StorageEvent('storage', { key: attendanceStoragePrefix }));
    expect(active.queue.getSnapshot().unsaved).toBe(2);
    release();
    await flush();
    expect(await own).toEqual({ ok: true });
    expect(server.students.map((student) => student.status)).toEqual(['present', 'absent']);
    expect(active.queue.getSnapshot().unsaved).toBe(0);
    expect(publicAttendanceApi.mark).toHaveBeenCalledTimes(2);
  });

  it('stops sending further writes after disposal and preserves them for the next visit', async () => {
    const old = make();
    let release: () => void = () => undefined;
    vi.mocked(publicAttendanceApi.mark).mockImplementationOnce((_id, input) => new Promise((resolve) => {
      release = () => resolve(commit(input));
    }));
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 100, status: 'present' });
    void old.queue.enqueue({ kind: 'one', lessonId: 10, studentId: 101, status: 'absent' });
    await flush();
    old.queue.dispose();
    release();
    await flush();
    expect(publicAttendanceApi.mark).toHaveBeenCalledTimes(1);
    expect(durableRequests()).toHaveLength(2);
    const restored = make(null);
    restored.queue.unlock();
    await flush();
    expect(server.students.map((student) => student.status)).toEqual(['present', 'absent']);
    expect(restored.queue.getSnapshot().unsaved).toBe(0);
  });
});
