import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PublicAttendanceMarkedStatus, PublicAttendanceRoster, PublicAttendanceSession, PublicAttendanceStatus, PublicAttendanceStudent,
} from '@shared/contracts/public-attendance';
import { publicAttendanceApi, PublicAttendanceApiError } from './api';
import {
  AttendanceMarkQueue, attendanceGroupsKey, attendanceMarkKey, attendanceRosterKey, type AttendanceLessonMarks, type AttendanceMarkNotice,
} from './markQueue';
import { attendanceLessonState, pickDefaultAttendanceGroup, pickDefaultAttendanceLesson } from './presentation';

export { pickDefaultAttendanceGroup, pickDefaultAttendanceLesson };

const sessionKey = ['public-attendance', 'session'] as const;
// Other visitors may be filling in the same register; a quiet re-read keeps the list honest.
const ROSTER_REFRESH_MS = 45_000;
const LESSON_START_WATCH_MS = 12 * 60 * 60 * 1000;
const NO_MARKS: AttendanceLessonMarks = { pending: 0, failed: 0 };
const isAccessError = (error: unknown) => error instanceof PublicAttendanceApiError && (error.status === 401 || error.status === 403);

export interface AttendanceStudentView extends PublicAttendanceStudent {
  /** What the row shows: the visitor's latest choice until the server confirms or refuses it. */
  shown: PublicAttendanceStatus;
  saving: boolean;
  failed: boolean;
  /** The mark the visitor chose that did not reach the server. */
  failedStatus: PublicAttendanceMarkedStatus | null;
  /** Someone else changed this mark while the visitor's own change was on its way. */
  changed: boolean;
}

export function usePublicAttendance({ onNotice }: { onNotice: (notice: AttendanceMarkNotice) => void }) {
  const client = useQueryClient();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [lessonId, setLessonId] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const session = useQuery({ queryKey: sessionKey, queryFn: ({ signal }) => publicAttendanceApi.session(signal), staleTime: 0 });
  const authenticated = session.data?.authenticated === true;
  // Set by signing out, so the session turning unauthenticated right after is not taken for an expiry.
  const signingOut = useRef(false);

  const forgetAccess = useCallback((reason: 'exit' | 'expired') => {
    if (reason === 'exit') signingOut.current = true;
    client.setQueryData<PublicAttendanceSession>(sessionKey, (data) => ({ available: data?.available ?? true, authenticated: false }));
    client.removeQueries({ predicate: (query) => query.queryKey[0] === 'public-attendance' && query.queryKey[1] !== 'session' });
    setExpired(reason === 'expired');
    // An expiry keeps the visitor's place, so signing in again returns to the same stream and lesson.
    if (reason === 'exit') {
      setGroupId(null);
      setLessonId(null);
    }
  }, [client]);

  // The queue outlives renders, so it reads the newest token and callbacks through a ref.
  const host = useRef({ csrfToken: session.data?.csrfToken, onNotice, forgetAccess });
  host.current = { csrfToken: session.data?.csrfToken, onNotice, forgetAccess };
  const [queue] = useState(() => new AttendanceMarkQueue(client, {
    csrfToken: () => host.current.csrfToken ?? '',
    onAccessLost: () => host.current.forgetAccess('expired'),
    onNotice: (notice) => host.current.onNotice(notice),
  }));
  const marks = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  const groups = useQuery({ queryKey: attendanceGroupsKey, queryFn: ({ signal }) => publicAttendanceApi.groups(signal), enabled: authenticated });
  const groupList = useMemo(() => groups.data?.groups ?? [], [groups.data]);
  const group = groupList.find((item) => item.id === groupId) ?? pickDefaultAttendanceGroup(groupList);
  const lesson = group?.lessons.find((item) => item.id === lessonId) ?? pickDefaultAttendanceLesson(group?.lessons ?? []);
  const busy = lesson ? marks.busyLessons.has(lesson.id) : false;

  const roster = useQuery({
    queryKey: attendanceRosterKey(lesson?.id),
    queryFn: async ({ signal }) => {
      const id = lesson!.id;
      const epoch = queue.epochOf(id);
      const data = await publicAttendanceApi.roster(id, signal);
      // A write for this lesson started or finished while this read was out; the write's answer is the fresher one.
      return queue.epochOf(id) === epoch ? data : client.getQueryData<PublicAttendanceRoster>(attendanceRosterKey(id)) ?? data;
    },
    enabled: authenticated && Boolean(lesson),
    // Stepping to the next lesson of the same stream keeps the old list on screen, dimmed, instead of collapsing the page.
    placeholderData: (previous) => previous && previous.lesson.groupId === lesson?.groupId ? previous : undefined,
    refetchInterval: busy ? false : ROSTER_REFRESH_MS,
    refetchOnWindowFocus: !busy,
  });

  // Pin the first choice so the page does not jump to another stream when the groups list is re-read.
  useEffect(() => { if (groupId === null && group) setGroupId(group.id); }, [group, groupId]);
  useEffect(() => { if (lessonId === null && lesson) setLessonId(lesson.id); }, [lesson, lessonId]);

  useEffect(() => {
    if (isAccessError(groups.error) || isAccessError(roster.error)) {
      queue.lock();
      forgetAccess('expired');
    }
  }, [forgetAccess, groups.error, queue, roster.error]);

  const wasAuthenticated = useRef(false);
  useEffect(() => {
    const was = wasAuthenticated.current;
    wasAuthenticated.current = authenticated;
    if (authenticated) {
      signingOut.current = false;
      // Marks held over an expiry, or restored from a closed tab, go out once a session is confirmed.
      queue.unlock();
      return;
    }
    if (!was) return;
    if (signingOut.current) {
      signingOut.current = false;
      return;
    }
    // The session ran out while the page sat in the background: the same as an expiry seen on a write.
    queue.lock();
    forgetAccess('expired');
  }, [authenticated, forgetAccess, queue]);

  useEffect(() => {
    queue.connect();
    const resume = () => queue.resume();
    const resumeIfVisible = () => { if (document.visibilityState === 'visible') queue.resume(); };
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resumeIfVisible);
    queue.resume();
    return () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resumeIfVisible);
      queue.dispose();
    };
  }, [queue]);

  // Closing the tab while a mark is still on its way asks first; the mark itself also waits in local storage.
  const unsaved = marks.unsaved > 0;
  useEffect(() => {
    if (!unsaved) return undefined;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only ask when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [unsaved]);

  // A lesson that has not started yet opens for marks by itself at its start time.
  const lessonStartsAt = lesson && !lesson.canMark ? new Date(lesson.scheduledAt).getTime() : null;
  useEffect(() => {
    if (lessonStartsAt === null) return undefined;
    const wait = lessonStartsAt - Date.now();
    if (wait <= 0 || wait > LESSON_START_WATCH_MS) return undefined;
    const timer = setTimeout(() => { void client.invalidateQueries({ queryKey: ['public-attendance'] }); }, wait + 1_000);
    return () => clearTimeout(timer);
  }, [client, lessonStartsAt]);

  const open = useMutation({
    mutationFn: publicAttendanceApi.open,
    onSuccess: (data) => {
      client.setQueryData(sessionKey, data);
      setExpired(false);
    },
  });
  const close = useMutation({
    mutationFn: () => publicAttendanceApi.close(host.current.csrfToken ?? ''),
    onSuccess: () => forgetAccess('exit'),
    onError: (error) => { if (isAccessError(error)) forgetAccess('exit'); },
  });
  const { mutate: closeAccess } = close;
  // Signing out drops whatever is still unsaved; the page asks first whenever there is something to lose.
  const signOut = useCallback((options?: { onError?: (error: unknown) => void }) => {
    queue.reset();
    closeAccess(undefined, options);
  }, [closeAccess, queue]);

  const rosterData = roster.data;
  const students = useMemo<AttendanceStudentView[]>(() => (rosterData?.students ?? []).map((student) => {
    const key = attendanceMarkKey(rosterData!.lesson.id, student.id);
    const saving = marks.overrides.has(key);
    const failedStatus = marks.failures.get(key)?.status ?? null;
    return {
      ...student, shown: saving ? marks.overrides.get(key) ?? null : student.status, saving,
      failed: failedStatus !== null, failedStatus, changed: marks.changed.has(key),
    };
  }), [marks.changed, marks.failures, marks.overrides, rosterData]);

  // Another lesson of this stream that has started and is still waiting for marks — where to go once this one is done.
  const nextOpenLesson = useMemo(() => {
    if (!group || !lesson) return undefined;
    const open = group.lessons.filter((item) => item.id !== lesson.id && attendanceLessonState(item) === 'open');
    return open.find((item) => item.number < lesson.number) ?? open[0];
  }, [group, lesson]);

  // The dimmed list of the previous lesson is only a placeholder: nothing on it can be marked.
  const rosterLessonId = roster.isPlaceholderData ? undefined : rosterData?.lesson.id;
  const mark = useCallback((studentId: number, status: PublicAttendanceStatus) => (
    rosterLessonId === undefined ? Promise.resolve({ ok: true as const }) : queue.enqueue({ kind: 'one', lessonId: rosterLessonId, studentId, status })
  ), [queue, rosterLessonId]);
  // A row whose last mark failed keeps its own "try again"; marking the rest never sweeps it up.
  const restIds = useMemo(() => students.filter((student) => student.shown === null && !student.failed).map((student) => student.id), [students]);
  const markRest = useCallback((status: PublicAttendanceMarkedStatus) => {
    if (rosterLessonId !== undefined && restIds.length) void queue.enqueue({ kind: 'many', lessonId: rosterLessonId, studentIds: restIds, status });
  }, [queue, restIds, rosterLessonId]);

  const shownLessonId = lesson?.id;
  const lessonMarks = (shownLessonId !== undefined && marks.lessons.get(shownLessonId)) || NO_MARKS;
  const retry = useCallback((studentId: number) => { if (rosterLessonId !== undefined) queue.retry(rosterLessonId, studentId); }, [queue, rosterLessonId]);
  const retryAll = useCallback(() => queue.retryAll(), [queue]);
  const retryLesson = useCallback(() => { if (shownLessonId !== undefined) queue.retryAll(shownLessonId); }, [queue, shownLessonId]);
  const chooseGroup = useCallback((id: number) => { setGroupId(id); setLessonId(null); }, []);
  const chooseLesson = useCallback((id: number) => setLessonId(id), []);
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: ['public-attendance'] }), [client]);

  return {
    session, groups, group, lesson, roster, students, marks, lessonMarks, bulkCount: restIds.length, open, signOut, authenticated, expired,
    nextOpenLesson, mark, markRest, retry, retryAll, retryLesson, chooseGroup, chooseLesson, refresh,
  };
}
