import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicAttendanceLesson, PublicAttendanceMark, PublicAttendanceSession } from '@shared/contracts/public-attendance';
import { publicAttendanceApi, PublicAttendanceApiError } from './api';

const sessionKey = ['public-attendance', 'session'] as const;
const groupsKey = ['public-attendance', 'groups'] as const;
const rosterKey = (id?: number) => ['public-attendance', 'roster', id] as const;
const localDay = (value: string | number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

export const pickDefaultAttendanceLesson = (lessons: PublicAttendanceLesson[], now = Date.now()) => {
  const today = lessons.find((lesson) => localDay(lesson.scheduledAt) === localDay(now));
  if (today) return today;
  const started = lessons.filter((lesson) => new Date(lesson.scheduledAt).getTime() <= now);
  return started[started.length - 1] ?? lessons[0];
};

export function usePublicAttendance() {
  const client = useQueryClient();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [lessonId, setLessonId] = useState<number | null>(null);
  const session = useQuery({ queryKey: sessionKey, queryFn: ({ signal }) => publicAttendanceApi.session(signal), staleTime: 0 });
  const authenticated = session.data?.authenticated === true;
  const groups = useQuery({ queryKey: groupsKey, queryFn: ({ signal }) => publicAttendanceApi.groups(signal), enabled: authenticated });
  const group = groups.data?.groups.find((item) => item.id === groupId) ?? groups.data?.groups[0];
  const lesson = group?.lessons.find((item) => item.id === lessonId) ?? pickDefaultAttendanceLesson(group?.lessons ?? []);
  const roster = useQuery({ queryKey: rosterKey(lesson?.id), queryFn: ({ signal }) => publicAttendanceApi.roster(lesson!.id, signal), enabled: authenticated && Boolean(lesson) });
  const forgetAccess = () => {
    client.setQueryData<PublicAttendanceSession>(sessionKey, { available: true, authenticated: false });
    client.removeQueries({ predicate: (query) => query.queryKey[0] === 'public-attendance' && query.queryKey[1] !== 'session' });
  };
  const handleAccessError = (error: unknown) => {
    if (error instanceof PublicAttendanceApiError && [401, 403].includes(error.status)) forgetAccess();
  };
  useEffect(() => {
    for (const error of [groups.error, roster.error]) {
      if (error instanceof PublicAttendanceApiError && [401, 403].includes(error.status)) {
        client.setQueryData<PublicAttendanceSession>(sessionKey, { available: true, authenticated: false });
        client.removeQueries({ predicate: (query) => query.queryKey[0] === 'public-attendance' && query.queryKey[1] !== 'session' });
      }
    }
  }, [client, groups.error, roster.error]);
  const open = useMutation({
    mutationFn: publicAttendanceApi.open,
    onSuccess: (data) => { client.setQueryData(sessionKey, data); setGroupId(null); setLessonId(null); },
  });
  const close = useMutation({
    mutationFn: () => publicAttendanceApi.close(session.data?.csrfToken ?? ''),
    onSuccess: forgetAccess, onError: handleAccessError,
  });
  const mark = useMutation({
    mutationFn: (input: PublicAttendanceMark) => publicAttendanceApi.mark(lesson!.id, input, session.data?.csrfToken ?? ''),
    onSuccess: (data) => {
      client.setQueryData(rosterKey(data.lesson.id), data);
      void client.invalidateQueries({ queryKey: groupsKey });
    },
    onError: (error) => {
      handleAccessError(error);
      if (error instanceof PublicAttendanceApiError && error.code === 'publicAttendanceConflict') void client.invalidateQueries({ queryKey: rosterKey(lesson?.id) });
    },
  });
  return {
    session, groups, group, lesson, roster, open, close, mark, authenticated,
    chooseGroup: (id: number) => { setGroupId(id); setLessonId(null); mark.reset(); },
    chooseLesson: (id: number) => { setLessonId(id); mark.reset(); },
    refresh: () => { mark.reset(); void client.invalidateQueries({ queryKey: ['public-attendance'] }); },
  };
}
