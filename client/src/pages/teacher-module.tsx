import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { MODULE_NAVIGATION, moduleSectionLabelKey } from '@/lib/moduleNavigation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ux/PageHeader';
import { ReportingDateRangeFilter } from '@/components/ux/ReportingDateRangeFilter';
import { TeacherAnalyticsCharts } from '@/components/ux/analytics/TeacherAnalyticsCharts';
import { TeacherOverviewKpis } from '@/components/ux/analytics/TeacherOverviewKpis';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { AttendanceCalendar } from '@/components/ux/AttendanceCalendar';
import { AttendanceLessonDialog } from '@/components/ux/teacher/AttendanceLessonDialog';
import { TeacherGroupsSection } from '@/components/ux/teacher/TeacherGroupsSection';
import {
  TeacherScheduleSection,
  type TeacherScheduleDayView,
} from '@/components/ux/teacher/TeacherScheduleSection';
import { TeacherSectionSkeleton } from '@/components/ux/teacher/TeacherSectionSkeleton';
import { TeacherTodayPanel } from '@/components/ux/teacher/TeacherTodayPanel';
import { AlertTriangle } from 'lucide-react';
import { sortAttendanceLessons } from '@/lib/attendance';
import { ACADEMY_TIME_ZONE, resolveLocale } from '@/lib/localeFormat';
import { buildTeacherScheduleDays } from '@/lib/teacherSchedule';
import { isInReportingRange, reportingRangeForPreset } from '@/lib/reportingDateRange';
import {
  academyDayKey,
  dateFromDayKey,
  isDayKey,
  shiftDayKey,
  weekStartDayKey,
  type TeacherAttendanceDraft,
  type TeacherAttendanceRecord,
  type TeacherGroup,
  type TeacherLesson,
  type TeacherSection,
  type TeacherStudent,
} from '@/lib/teacherModule';
import { buildAnalyticsTimeline, percentage } from '@/lib/analyticsCharts';

type SaveAttendanceVariables = {
  lessonId: number;
  roster: Array<{ id: number }>;
  draft: TeacherAttendanceDraft;
  note?: string;
};

type RescheduleLessonVariables = {
  lessonId: number;
  payload: { scheduledAt: string; reason: string };
};

type AcademyDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const academyDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACADEMY_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function academyDateTimeParts(value: Date): AcademyDateTimeParts {
  const parts: Record<string, number> = {};
  for (const part of academyDateTimeFormatter.formatToParts(value)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function academyTimeZoneOffsetMs(value: Date): number {
  const parts = academyDateTimeParts(value);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallClockAsUtc - Math.floor(value.getTime() / 1_000) * 1_000;
}

function academyWallClockToDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const normalized = new Date(wallClockAsUtc);
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() + 1 !== month
    || normalized.getUTCDate() !== day
    || normalized.getUTCHours() !== hour
    || normalized.getUTCMinutes() !== minute
  ) return null;

  let candidate = wallClockAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = wallClockAsUtc - academyTimeZoneOffsetMs(new Date(candidate));
    if (next === candidate) break;
    candidate = next;
  }
  const result = new Date(candidate);
  const resolved = academyDateTimeParts(result);
  return resolved.year === year
    && resolved.month === month
    && resolved.day === day
    && resolved.hour === hour
    && resolved.minute === minute
    ? result
    : null;
}

function localDateKey(value: string): string {
  const { year, month: rawMonth, day: rawDay } = academyDateTimeParts(new Date(value));
  const month = String(rawMonth).padStart(2, '0');
  const day = String(rawDay).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateTimeLocal(value: Date): string {
  const { year, month: rawMonth, day: rawDay, hour, minute } = academyDateTimeParts(value);
  const month = String(rawMonth).padStart(2, '0');
  const day = String(rawDay).padStart(2, '0');
  const hours = String(hour).padStart(2, '0');
  const minutes = String(minute).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/* A minute is the finest granularity anything on this screen cares about. The
   page used to re-render — and re-sort every lesson — once a second. */
const CLOCK_TICK_MS = 30_000;

export default function TeacherModule({ section = 'overview' }: { section?: TeacherSection }) {
  const { t, language } = useTranslation();
  const locale = resolveLocale(language);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const routeSearch = useSearch();

  const dayNames = [
    t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort'),
  ];
  const dayNamesFull = [
    t('monday'), t('tuesday'), t('wednesday'), t('thursday'),
    t('friday'), t('saturday'), t('sunday'),
  ];

  /* Everything the teacher can point at — the open lesson, the open group, the
     visible week — lives in the URL. Back, reload and a pasted link now all do
     what the browser promises, and the schedule's "attendance" button can hand
     a specific lesson to another route instead of losing it on unmount. */
  const searchParams = useMemo(() => new URLSearchParams(routeSearch), [routeSearch]);
  const lessonParam = searchParams.get('lesson') ?? '';
  const groupParam = searchParams.get('group') ?? '';
  const weekParam = searchParams.get('week') ?? '';

  const pathname = location.split('?')[0];
  const buildHref = useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(routeSearch);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, routeSearch]);

  /* Panning the schedule or opening a lesson replaces the entry — the Back
     button should leave the module, not walk back through every week the
     teacher scrolled past. Opening a group pushes, because "back to the list"
     is exactly what Back is expected to do there. */
  const replaceParams = useCallback((changes: Record<string, string | null>) => {
    setLocation(buildHref(changes), { replace: true });
  }, [buildHref, setLocation]);

  const pushParams = useCallback((changes: Record<string, string | null>) => {
    setLocation(buildHref(changes));
  }, [buildHref, setLocation]);

  const [attendanceDraft, setAttendanceDraft] = useState<TeacherAttendanceDraft>({});
  const [attendanceNote, setAttendanceNote] = useState('');
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isRescheduleConfirmOpen, setRescheduleConfirmOpen] = useState(false);
  const [bulkConfirmStatus, setBulkConfirmStatus] = useState<'present' | 'absent' | null>(null);
  const [pendingLessonSwitch, setPendingLessonSwitch] = useState<string | null>(null);
  const [pendingDialogClose, setPendingDialogClose] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const attendanceDraftDirty = useRef(false);
  const attendanceNoteDirty = useRef(false);
  const hydratedAttendanceLessonId = useRef<number | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);
  const nowMinute = Math.floor(now / 60_000) * 60_000;

  const [reportingRange, setReportingRange] = useState(() => reportingRangeForPreset('thisMonth'));
  const { data, isLoading, isError, error, refetch } = useQuery<any>({
    queryKey: ['/api/academy/modules/teacher'],
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/teacher'] }),
    [queryClient],
  );

  const saveAttendance = useMutation<unknown, Error, SaveAttendanceVariables>({
    mutationFn: ({ lessonId, roster, draft, note }) =>
      apiRequest('POST', `/api/academy/lessons/${lessonId}/attendance`, {
        lessonStatus: 'conducted',
        attendance: roster.map((student) => ({
          studentId: student.id,
          status: draft[student.id],
          ...(note !== undefined ? { note } : {}),
        })),
      }),
    onSuccess: (_result, variables) => {
      toast({ title: t('attendanceSaved'), description: t('attendanceSavedDesc') });
      attendanceDraftDirty.current = false;
      attendanceNoteDirty.current = false;
      queryClient.invalidateQueries({
        queryKey: ['/api/academy/lessons', variables.lessonId, 'attendance-roster'],
      });
      invalidate();
    },
    onError: (mutationError: Error) =>
      toast({ title: t('error'), description: mutationError.message, variant: 'destructive' }),
  });

  const groups: TeacherGroup[] = useMemo(() => data?.groups ?? [], [data]);
  const lessons: TeacherLesson[] = useMemo(() => data?.lessons ?? [], [data]);
  const students: TeacherStudent[] = useMemo(() => data?.students ?? [], [data]);
  const attendanceRecords: TeacherAttendanceRecord[] = useMemo(() => data?.attendance ?? [], [data]);

  const groupLessonProgressById = useMemo(() => {
    const lessonCounts = new Map<number, { conducted: number; materialized: number }>();
    for (const lesson of lessons) {
      const groupId = Number(lesson.groupId);
      const counts = lessonCounts.get(groupId) ?? { conducted: 0, materialized: 0 };
      counts.materialized += 1;
      if (lesson.status === 'conducted') counts.conducted += 1;
      lessonCounts.set(groupId, counts);
    }
    const progress = new Map<number, { conducted: number; total: number }>();
    for (const group of groups) {
      const counts = lessonCounts.get(Number(group.id)) ?? { conducted: 0, materialized: 0 };
      progress.set(group.id, {
        conducted: counts.conducted,
        total: Number(group.lessonCount) || counts.materialized,
      });
    }
    return progress;
  }, [groups, lessons]);

  const totalStudents = useMemo(
    () => groups.reduce((sum, group) => sum + (group.currentStudents || 0), 0),
    [groups],
  );

  /* A group with no declared capacity is excluded from the denominator instead
     of being padded with an invented 12 seats — a silently wrong occupancy is
     worse than an honestly partial one. */
  const capacityGroups = useMemo(
    () => groups.filter((group) => Number(group.maxStudents) > 0),
    [groups],
  );
  const totalCapacity = useMemo(
    () => capacityGroups.reduce((sum, group) => sum + Number(group.maxStudents), 0),
    [capacityGroups],
  );

  const todayKey = localDateKey(new Date(nowMinute).toISOString());
  const todayLessons = useMemo(
    () => lessons.filter((lesson) => localDateKey(lesson.scheduledAt) === todayKey),
    [lessons, todayKey],
  );
  const pendingAttendanceLessons = useMemo(
    () => lessons
      .filter((lesson) => (
        lesson.status === 'scheduled'
        && new Date(lesson.scheduledAt).getTime() <= nowMinute
      ))
      .sort((left, right) => (
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      )),
    [lessons, nowMinute],
  );
  /* A lesson between its start and its end is the one the teacher is standing
     in, and the only one whose attendance can actually be saved. The overview
     leads with it; otherwise it leads with the next one and offers a link into
     the schedule rather than a checklist that cannot be submitted yet. */
  const liveLesson = useMemo(
    () => lessons.find((lesson) => {
      if (lesson.status !== 'scheduled') return false;
      const start = new Date(lesson.scheduledAt).getTime();
      if (!Number.isFinite(start)) return false;
      const end = start + Number(lesson.durationMinutes || 0) * 60_000;
      return start <= nowMinute && nowMinute < end;
    }) ?? null,
    [lessons, nowMinute],
  );
  const nextLesson = useMemo(
    () => lessons
      .filter((lesson) => (
        lesson.status === 'scheduled'
        && new Date(lesson.scheduledAt).getTime() > nowMinute
      ))
      .sort((left, right) => (
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      ))[0] ?? null,
    [lessons, nowMinute],
  );

  const periodLessons = useMemo(
    () => lessons.filter((lesson) => (
      lesson.status !== 'cancelled'
      && isInReportingRange(lesson.scheduledAt, reportingRange)
    )),
    [lessons, reportingRange],
  );
  const conductedPeriodLessons = useMemo(
    () => periodLessons.filter((lesson) => lesson.status === 'conducted'),
    [periodLessons],
  );
  const periodLessonIds = useMemo(
    () => new Set(periodLessons.map((lesson) => Number(lesson.id))),
    [periodLessons],
  );
  const periodAttendanceRecords = useMemo(
    () => attendanceRecords.filter((record) => periodLessonIds.has(Number(record.lessonId))),
    [attendanceRecords, periodLessonIds],
  );
  const avgAttendance = useMemo(() => {
    if (!periodAttendanceRecords.length) return null;
    const presentCount = periodAttendanceRecords.filter((record) => record.status === 'present').length;
    return Math.round((presentCount / periodAttendanceRecords.length) * 100);
  }, [periodAttendanceRecords]);

  const teachingHours = useMemo(
    () => conductedPeriodLessons.reduce(
      (sum, lesson) => sum + Number(lesson.durationMinutes || 0) / 60,
      0,
    ),
    [conductedPeriodLessons],
  );

  const teacherTimeline = useMemo(() => {
    const lessonDateById = new Map(periodLessons.map((lesson) => [Number(lesson.id), lesson.scheduledAt]));
    const timeline = buildAnalyticsTimeline([
      ...periodLessons.map((lesson) => ({
        at: lesson.scheduledAt,
        series: lesson.status === 'conducted' ? 'conducted' : 'pending',
      })),
      ...periodAttendanceRecords.flatMap((record) => {
        const at = lessonDateById.get(Number(record.lessonId));
        return at ? [{ at, series: record.status }] : [];
      }),
    ], reportingRange, locale, ['conducted', 'pending', 'present', 'absent']);

    return timeline.map((point) => {
      const present = Number(point.present || 0);
      const absent = Number(point.absent || 0);
      const markedAttendance = present + absent;
      return {
        periodStart: point.periodStart,
        label: point.label,
        conducted: Number(point.conducted || 0),
        pending: Number(point.pending || 0),
        present,
        absent,
        attendance: markedAttendance > 0 ? percentage(present, markedAttendance) : null,
      };
    });
  }, [locale, periodAttendanceRecords, periodLessons, reportingRange]);

  const groupQuality = useMemo(() => {
    const rows = groups.flatMap((group) => {
      const groupLessons = periodLessons.filter((lesson) => Number(lesson.groupId) === Number(group.id));
      if (groupLessons.length === 0) return [];
      const lessonIds = new Set(groupLessons.map((lesson) => Number(lesson.id)));
      const records = periodAttendanceRecords.filter((record) => lessonIds.has(Number(record.lessonId)));
      return [{
        name: group.name,
        lessonVolume: groupLessons.length,
        completion: percentage(
          groupLessons.filter((lesson) => lesson.status === 'conducted').length,
          groupLessons.length,
        ),
        attendance: records.length > 0
          ? percentage(
            records.filter((record) => record.status === 'present').length,
            records.length,
          )
          : null,
      }];
    });
    return rows.sort((left, right) => right.lessonVolume - left.lessonVolume);
  }, [groups, periodAttendanceRecords, periodLessons]);

  /* `present` / `absent` are the labels on one student's two buttons; as pie
     slice names they came out as "Отсутствовал" — masculine singular about a
     category counting everybody. */
  const attendanceDistribution = useMemo(() => [
    {
      name: t('attendancePresentSeries'),
      value: periodAttendanceRecords.filter((record) => record.status === 'present').length,
      color: 'var(--chart-1)',
    },
    {
      name: t('attendanceAbsentSeries'),
      value: periodAttendanceRecords.filter((record) => record.status === 'absent').length,
      color: 'var(--chart-5)',
    },
  ], [periodAttendanceRecords, t]);

  const teacherCourses = useMemo(() => {
    const courseIds = new Set<number>();
    groups.forEach((group) => {
      if (group.courseId) courseIds.add(group.courseId);
    });
    return data?.courses?.filter((course: any) => courseIds.has(course.id)) ?? [];
  }, [groups, data]);

  // Schedule: a real, navigable Monday-to-Sunday week synchronised with the URL.
  const currentWeekKey = weekStartDayKey(todayKey);
  const scheduleWeekKey = isDayKey(weekParam) ? weekStartDayKey(weekParam) : currentWeekKey;
  const scheduleDays: TeacherScheduleDayView[] = useMemo(() => {
    const lessonsByDate = new Map<string, TeacherLesson[]>();
    for (const lesson of lessons) {
      const dateKey = localDateKey(lesson.scheduledAt);
      const dayLessons = lessonsByDate.get(dateKey) ?? [];
      dayLessons.push(lesson);
      lessonsByDate.set(dateKey, dayLessons);
    }
    return buildTeacherScheduleDays(dateFromDayKey(scheduleWeekKey), ACADEMY_TIME_ZONE).map((day) => ({
      ...day,
      lessons: [...(lessonsByDate.get(day.dateKey) ?? [])].sort(
        (left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
      ),
    }));
  }, [lessons, scheduleWeekKey]);

  const selectedLessonId = section === 'attendance' ? lessonParam : '';
  const selectedLesson = useMemo(
    () => lessons.find((lesson) => String(lesson.id) === selectedLessonId),
    [lessons, selectedLessonId],
  );

  const attendanceLessons = useMemo(
    () => sortAttendanceLessons(lessons, nowMinute),
    [lessons, nowMinute],
  );

  const previousIncompleteLesson = useMemo(() => {
    if (!selectedLesson || selectedLesson.status === 'conducted') return null;
    return lessons
      .filter((lesson) => (
        lesson.groupId === selectedLesson.groupId
        && lesson.status === 'scheduled'
        && new Date(lesson.scheduledAt).getTime() < new Date(selectedLesson.scheduledAt).getTime()
      ))
      .sort((left, right) => (
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      ))[0] ?? null;
  }, [lessons, selectedLesson]);

  const attendanceRosterQuery = useQuery<{
    lesson: TeacherLesson;
    students: TeacherStudent[];
    attendance: TeacherAttendanceRecord[];
  }>({
    queryKey: ['/api/academy/lessons', Number(selectedLessonId), 'attendance-roster'],
    queryFn: () => apiRequest('GET', `/api/academy/lessons/${selectedLessonId}/attendance-roster`),
    enabled: Boolean(selectedLessonId),
  });
  const rosterLesson = attendanceRosterQuery.data?.lesson;
  const selectedLessonDetails = useMemo(
    () => (selectedLesson ? { ...selectedLesson, ...(rosterLesson ?? {}) } : rosterLesson),
    [rosterLesson, selectedLesson],
  );

  const rescheduleLesson = useMutation<
    { shiftedCount?: number },
    Error,
    RescheduleLessonVariables
  >({
    mutationFn: ({ lessonId, payload }) => (
      apiRequest('POST', `/api/academy/lessons/${lessonId}/reschedule`, payload)
    ),
    onSuccess: (result, variables) => {
      toast({
        title: t('lessonRescheduled'),
        description: t('lessonRescheduledDesc').replace('{count}', String(result.shiftedCount ?? 1)),
      });
      setRescheduleReason('');
      setRescheduleAt('');
      setRescheduleConfirmOpen(false);
      queryClient.invalidateQueries({
        queryKey: ['/api/academy/lessons', variables.lessonId, 'attendance-roster'],
      });
      invalidate();
    },
    onError: (mutationError: Error) => toast({
      title: t('error'),
      description: mutationError.message,
      variant: 'destructive',
    }),
  });

  /* Every piece of dialog state resets in one place when the lesson changes.
     The reschedule form in particular used to survive the switch, so the next
     lesson opened with a pre-filled date next to an irreversible button. */
  useEffect(() => {
    setRescheduleAt('');
    setRescheduleReason('');
    setIsRescheduleOpen(false);
    setRescheduleConfirmOpen(false);
    setBulkConfirmStatus(null);
  }, [selectedLessonId]);

  const selectedLessonStudents = useMemo(
    () => (selectedLessonId ? attendanceRosterQuery.data?.students ?? [] : []),
    [attendanceRosterQuery.data?.students, selectedLessonId],
  );
  const selectedAttendanceRecords = useMemo(
    () => (selectedLessonId ? attendanceRosterQuery.data?.attendance ?? [] : []),
    [attendanceRosterQuery.data?.attendance, selectedLessonId],
  );

  const attendanceHydration = useMemo(() => {
    const lessonId = selectedLessonId ? Number(selectedLessonId) : null;
    const studentIds = new Set(selectedLessonStudents.map((student) => student.id));
    const draft: TeacherAttendanceDraft = {};
    for (const record of selectedAttendanceRecords) {
      if (studentIds.has(record.studentId) && (record.status === 'present' || record.status === 'absent')) {
        draft[record.studentId] = record.status;
      }
    }
    const distinctNotes = new Set(
      selectedAttendanceRecords
        .map((record) => record.note?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    return {
      lessonId,
      draft,
      note: [...distinctNotes][0] ?? '',
      hasDivergingNotes: distinctNotes.size > 1,
    };
  }, [selectedAttendanceRecords, selectedLessonId, selectedLessonStudents]);

  useEffect(() => {
    if (attendanceHydration.lessonId == null) {
      setAttendanceDraft({});
      setAttendanceNote('');
      attendanceDraftDirty.current = false;
      attendanceNoteDirty.current = false;
      hydratedAttendanceLessonId.current = null;
      return;
    }
    const changedLesson = hydratedAttendanceLessonId.current !== attendanceHydration.lessonId;
    if (!changedLesson && attendanceDraftDirty.current) return;
    setAttendanceDraft(attendanceHydration.draft);
    setAttendanceNote(attendanceHydration.note);
    hydratedAttendanceLessonId.current = attendanceHydration.lessonId;
    attendanceDraftDirty.current = false;
    attendanceNoteDirty.current = false;
  }, [attendanceHydration]);

  const allAttendanceMarked = selectedLessonStudents.every(
    (student) => attendanceDraft[student.id] !== undefined,
  );
  const selectedLessonHasStarted = Boolean(
    selectedLessonDetails && new Date(selectedLessonDetails.scheduledAt).getTime() <= now,
  );
  const canSaveAttendance = Boolean(
    selectedLessonDetails
    && allAttendanceMarked
    && !attendanceRosterQuery.isPending
    && !attendanceRosterQuery.isError
    && !previousIncompleteLesson
    && (selectedLessonDetails.status === 'conducted' || selectedLessonHasStarted),
  );
  const parsedRescheduleAt = rescheduleAt ? academyWallClockToDate(rescheduleAt) : null;
  const rescheduleTimestamp = parsedRescheduleAt?.getTime() ?? Number.NaN;
  const canRescheduleLesson = Boolean(
    ['scheduled', 'conducted'].includes(selectedLessonDetails?.status ?? '')
    && Number.isFinite(rescheduleTimestamp)
    && rescheduleTimestamp > now
    && rescheduleReason.trim(),
  );
  const lessonMutationPending = saveAttendance.isPending || rescheduleLesson.isPending;

  const selectedGroup = useMemo(() => {
    const groupId = Number(groupParam);
    if (!Number.isFinite(groupId) || groupId <= 0) return null;
    return groups.find((group) => Number(group.id) === groupId) ?? null;
  }, [groupParam, groups]);

  const groupStudents = useMemo(() => {
    if (!selectedGroup) return [];
    return students.filter((student) => (
      student.groupIds?.some((groupId) => Number(groupId) === Number(selectedGroup.id))
      || Number(student.groupId) === Number(selectedGroup.id)
    ));
  }, [students, selectedGroup]);

  const selectedGroupAttendanceByStudentId = useMemo(() => {
    if (!selectedGroup) return new Map<number, { attended: number; missed: number }>();
    const conductedLessonIds = new Set(
      lessons
        .filter((lesson) => (
          Number(lesson.groupId) === Number(selectedGroup.id)
          && lesson.status === 'conducted'
        ))
        .map((lesson) => Number(lesson.id)),
    );
    const counts = new Map<number, { attended: number; missed: number }>();
    for (const record of attendanceRecords) {
      if (!conductedLessonIds.has(Number(record.lessonId))) continue;
      const current = counts.get(Number(record.studentId)) ?? { attended: 0, missed: 0 };
      if (record.status === 'present') current.attended += 1;
      if (record.status === 'absent') current.missed += 1;
      counts.set(Number(record.studentId), current);
    }
    return counts;
  }, [attendanceRecords, lessons, selectedGroup]);

  /* One container for the whole module. Overview used to be the odd one out —
     `p-4 sm:p-6 lg:p-8` and a document scroll against `p-4 sm:p-5 lg:p-6` and
     an inner scroller everywhere else — so moving between sections shifted the
     content sideways and changed what scrolls under the finger. */
  const contained = true;
  const fullName = user?.fullName || t('teacher');
  const sectionTitle: Record<TeacherSection, string> = {
    overview: t(moduleSectionLabelKey('teacher', 'overview')),
    schedule: t(moduleSectionLabelKey('teacher', 'schedule')),
    groups: t(moduleSectionLabelKey('teacher', 'groups')),
    attendance: t(moduleSectionLabelKey('teacher', 'attendance')),
  };

  const handleToggleAttendance = useCallback((studentId: number, status: 'present' | 'absent') => {
    if (lessonMutationPending) return;
    attendanceDraftDirty.current = true;
    setAttendanceDraft((previous) => ({ ...previous, [studentId]: status }));
  }, [lessonMutationPending]);

  const handleSetAllAttendance = useCallback((status: 'present' | 'absent') => {
    if (lessonMutationPending) return;
    attendanceDraftDirty.current = true;
    const update: TeacherAttendanceDraft = {};
    selectedLessonStudents.forEach((student) => {
      update[student.id] = status;
    });
    setAttendanceDraft(update);
  }, [lessonMutationPending, selectedLessonStudents]);

  /* Overwriting fourteen hand-made marks is a destructive action, so it asks
     first — but only when there is something to lose. */
  const handleRequestSetAll = useCallback((status: 'present' | 'absent') => {
    const hasMarks = selectedLessonStudents.some(
      (student) => attendanceDraft[student.id] !== undefined,
    );
    if (!hasMarks) {
      handleSetAllAttendance(status);
      return;
    }
    setBulkConfirmStatus(status);
  }, [attendanceDraft, handleSetAllAttendance, selectedLessonStudents]);

  const handleSaveAttendance = useCallback(() => {
    if (!selectedLessonDetails || !canSaveAttendance || lessonMutationPending) return;
    saveAttendance.mutate({
      lessonId: selectedLessonDetails.id,
      roster: selectedLessonStudents.map(({ id }) => ({ id })),
      draft: { ...attendanceDraft },
      note: attendanceNoteDirty.current ? attendanceNote : undefined,
    });
  }, [
    attendanceDraft,
    attendanceNote,
    canSaveAttendance,
    lessonMutationPending,
    saveAttendance,
    selectedLessonDetails,
    selectedLessonStudents,
  ]);

  const handleRescheduleLesson = useCallback(() => {
    if (!selectedLessonDetails || !parsedRescheduleAt || !canRescheduleLesson || lessonMutationPending) return;
    rescheduleLesson.mutate({
      lessonId: selectedLessonDetails.id,
      payload: {
        scheduledAt: parsedRescheduleAt.toISOString(),
        reason: rescheduleReason.trim(),
      },
    });
  }, [
    canRescheduleLesson,
    lessonMutationPending,
    parsedRescheduleAt,
    rescheduleLesson,
    rescheduleReason,
    selectedLessonDetails,
  ]);

  const openAttendanceForLesson = useCallback((lessonId: string) => {
    if (section === 'attendance') {
      replaceParams({ lesson: lessonId });
      return;
    }
    setLocation(`/teacher-module/attendance?lesson=${encodeURIComponent(lessonId)}`);
  }, [replaceParams, section, setLocation]);

  /* Lands on the schedule week that contains the lesson, not on the current
     one — a lesson three weeks out is useless if the link drops you on today. */
  const openLessonInSchedule = useCallback((lessonId: string) => {
    const lesson = lessons.find((item) => String(item.id) === lessonId);
    if (!lesson) {
      setLocation('/teacher-module/schedule');
      return;
    }
    const week = weekStartDayKey(academyDayKey(lesson.scheduledAt));
    setLocation(`/teacher-module/schedule?week=${week}`);
  }, [lessons, setLocation]);

  const handleLessonSelect = useCallback((lessonId: string) => {
    if (lessonMutationPending || lessonId === selectedLessonId) return;
    if (selectedLessonId && attendanceDraftDirty.current) {
      setPendingLessonSwitch(lessonId);
      return;
    }
    openAttendanceForLesson(lessonId);
  }, [lessonMutationPending, openAttendanceForLesson, selectedLessonId]);

  const handleDialogCloseRequest = useCallback((open: boolean) => {
    if (open) return;
    if (attendanceDraftDirty.current) {
      setPendingDialogClose(true);
      return;
    }
    attendanceDraftDirty.current = false;
    attendanceNoteDirty.current = false;
    replaceParams({ lesson: null });
  }, [replaceParams]);

  const confirmDialogClose = useCallback(() => {
    setPendingDialogClose(false);
    attendanceDraftDirty.current = false;
    attendanceNoteDirty.current = false;
    replaceParams({ lesson: null });
  }, [replaceParams]);

  const confirmLessonSwitch = useCallback(() => {
    if (!pendingLessonSwitch) return;
    attendanceDraftDirty.current = false;
    attendanceNoteDirty.current = false;
    replaceParams({ lesson: pendingLessonSwitch });
    setPendingLessonSwitch(null);
  }, [pendingLessonSwitch, replaceParams]);

  // Protect against accidental page close with unsaved attendance data
  useEffect(() => {
    if (section !== 'attendance') return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      if (attendanceDraftDirty.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [section]);

  /* The page frame — title, breadcrumbs, section navigation — is rendered by
     the same tree in every state. Errors and loading used to replace it and
     leave the user with no idea where they were. */
  const header = (
    <PageHeader
      title={sectionTitle[section]}
      subtitle={section === 'overview'
        ? t('teacherGreeting').replace('{name}', fullName)
        : t(MODULE_NAVIGATION.teacher.nameKey)}
      breadcrumbs={[
        { label: t(MODULE_NAVIGATION.teacher.nameKey), href: '/teacher-module' },
        ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
      ]}
    />
  );

  const renderBody = () => {
    if (isError) {
      return (
        <Card className="border-destructive/40">
          <CardContent className="mx-auto max-w-xl space-y-4 py-14 text-center">
            <p className="font-medium text-destructive">{t('error')}</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : t('failedToLoadData')}
            </p>
            <Button variant="outline" className="min-h-11" onClick={() => refetch()}>{t('retry')}</Button>
          </CardContent>
        </Card>
      );
    }

    if (isLoading || !data) return <TeacherSectionSkeleton section={section} />;

    if (section === 'overview') {
      return (
        <div className="space-y-4">
          <TeacherTodayPanel
            focusLesson={liveLesson ?? nextLesson}
            isLessonLive={liveLesson !== null}
            isFocusLessonToday={(() => {
              const focus = liveLesson ?? nextLesson;
              return focus != null && localDateKey(focus.scheduledAt) === todayKey;
            })()}
            todayCount={todayLessons.length}
            pendingLessons={pendingAttendanceLessons}
            onOpenAttendance={openAttendanceForLesson}
            onOpenLessonInSchedule={openLessonInSchedule}
            onOpenSchedule={() => setLocation('/teacher-module/schedule')}
          />
          <ReportingDateRangeFilter value={reportingRange} onChange={setReportingRange} />
          <TeacherOverviewKpis
            data={{
              groupsCount: groups.length,
              courseNames: teacherCourses.map((course: any) => course.name).join(', ') || t('noData'),
              totalStudents,
              totalCapacity,
              capacityGroupsCount: capacityGroups.length,
              conductedLessons: conductedPeriodLessons.length,
              totalLessons: periodLessons.length,
              avgAttendance,
              teachingHours: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(teachingHours),
            }}
          />
          <TeacherAnalyticsCharts
            timeline={teacherTimeline}
            groupQuality={groupQuality}
            attendance={attendanceDistribution}
          />
        </div>
      );
    }

    if (section === 'schedule') {
      return (
        <TeacherScheduleSection
          days={scheduleDays}
          dayNames={dayNames}
          todayKey={todayKey}
          atToday={scheduleWeekKey === currentWeekKey}
          onPreviousWeek={() => replaceParams({ week: shiftDayKey(scheduleWeekKey, -7) })}
          onNextWeek={() => replaceParams({ week: shiftDayKey(scheduleWeekKey, 7) })}
          onToday={() => replaceParams({ week: null })}
          onOpenAttendance={openAttendanceForLesson}
        />
      );
    }

    if (section === 'groups') {
      return (
        <TeacherGroupsSection
          groups={groups}
          selectedGroup={selectedGroup}
          groupStudents={groupStudents}
          progressById={groupLessonProgressById}
          attendanceByStudentId={selectedGroupAttendanceByStudentId}
          dayNames={dayNames}
          dayNamesFull={dayNamesFull}
          onSelectGroup={(groupId) => pushParams({ group: groupId === null ? null : String(groupId) })}
        />
      );
    }

    return (
      <AttendanceCalendar
        lessons={attendanceLessons}
        selectedLessonId={selectedLessonId}
        now={nowMinute}
        disabled={lessonMutationPending}
        onSelectLesson={handleLessonSelect}
      />
    );
  };

  return (
    <ModulePage contained={contained}>
      {header}

      <ModulePageBody contained={contained} ariaLabel={sectionTitle[section]}>
        {renderBody()}
      </ModulePageBody>

      {section === 'attendance' ? (
        <>
          <AlertDialog
            open={pendingLessonSwitch !== null}
            onOpenChange={(open) => { if (!open) setPendingLessonSwitch(null); }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-amber-500" />
                  {t('unsavedAttendanceTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('unsavedAttendanceDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setPendingLessonSwitch(null)}>
                  {t('keepEditing')}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmLessonSwitch}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('discardChanges')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={pendingDialogClose} onOpenChange={setPendingDialogClose}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-amber-500" />
                  {t('unsavedAttendanceTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('unsavedAttendanceDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setPendingDialogClose(false)}>
                  {t('keepEditing')}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDialogClose}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('discardChanges')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AttendanceLessonDialog
            open={Boolean(selectedLessonId)}
            onOpenChange={handleDialogCloseRequest}
            lesson={selectedLessonDetails}
            students={selectedLessonStudents}
            draft={attendanceDraft}
            note={attendanceNote}
            hasDivergingNotes={attendanceHydration.hasDivergingNotes}
            onNoteChange={(value) => {
              attendanceDraftDirty.current = true;
              attendanceNoteDirty.current = true;
              setAttendanceNote(value);
            }}
            onToggleStudent={handleToggleAttendance}
            onSetAll={handleSetAllAttendance}
            onRequestSetAll={handleRequestSetAll}
            onSave={handleSaveAttendance}
            canSave={canSaveAttendance}
            isSaving={saveAttendance.isPending}
            isRosterPending={Boolean(selectedLessonId) && attendanceRosterQuery.isPending}
            isRosterError={Boolean(selectedLessonId) && attendanceRosterQuery.isError}
            rosterErrorMessage={attendanceRosterQuery.error instanceof Error
              ? attendanceRosterQuery.error.message
              : t('failedToLoadData')}
            onRetryRoster={() => attendanceRosterQuery.refetch()}
            mutationPending={lessonMutationPending}
            lessonHasStarted={selectedLessonHasStarted}
            hasPreviousIncompleteLesson={Boolean(previousIncompleteLesson)}
            rescheduleOpen={isRescheduleOpen}
            onRescheduleOpenChange={setIsRescheduleOpen}
            rescheduleAt={rescheduleAt}
            onRescheduleAtChange={setRescheduleAt}
            rescheduleReason={rescheduleReason}
            onRescheduleReasonChange={setRescheduleReason}
            rescheduleAtDate={parsedRescheduleAt}
            rescheduleMin={toDateTimeLocal(new Date(now + 5 * 60 * 1000))}
            canReschedule={canRescheduleLesson}
            isRescheduling={rescheduleLesson.isPending}
            onConfirmReschedule={handleRescheduleLesson}
            rescheduleConfirmOpen={isRescheduleConfirmOpen}
            onRescheduleConfirmOpenChange={setRescheduleConfirmOpen}
            bulkConfirmStatus={bulkConfirmStatus}
            onBulkConfirmChange={setBulkConfirmStatus}
          />
        </>
      ) : null}
    </ModulePage>
  );
}
