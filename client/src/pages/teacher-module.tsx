import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { MODULE_NAVIGATION, moduleSectionLabelKey } from '@/lib/moduleNavigation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';

import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import { PageHeader } from '@/components/ux/PageHeader';
import { ReportingDateRangeFilter } from '@/components/ux/ReportingDateRangeFilter';
import { TeacherAnalyticsCharts } from '@/components/ux/analytics/TeacherAnalyticsCharts';
import { TeacherOverviewKpis } from '@/components/ux/analytics/TeacherOverviewKpis';
import { AnalyticsChartsSkeleton } from '@/components/ux/analytics/AnalyticsChartCard';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { AttendanceCalendar } from '@/components/ux/AttendanceCalendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertTriangle,
  Calendar,
  Users,
  ClipboardCheck,
  Star,
  GraduationCap,
  ClipboardList,
  CheckCircle2,
  Clock3,
  XCircle,
  TrendingUp,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sortAttendanceLessons } from '@/lib/attendance';
import { buildTeacherScheduleDays } from '@/lib/teacherSchedule';
import { isInReportingRange, reportingRangeForPreset } from '@/lib/reportingDateRange';
import {
  buildAnalyticsTimeline,
  compactRankedSeries,
  percentage,
} from '@/lib/analyticsCharts';

type Lesson = {
  id: number;
  groupId: number;
  groupName?: string;
  courseId?: number;
  courseName?: string;
  teacherId?: number;
  teacherName?: string;
  schoolId?: number;
  schoolName?: string;
  lessonNumber: number;
  topic: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
};

type TeacherSection = 'overview' | 'schedule' | 'groups' | 'attendance' | 'ratings';

type Group = {
  id: number;
  name: string;
  courseId: number;
  courseName?: string;
  teacherId?: number;
  teacherName?: string;
  schoolId?: number;
  schoolName?: string;
  lessonCount: number;
  maxStudents: number;
  currentStudents?: number;
  capacityLabel?: string;
  schedule?: Array<{ dayOfWeek: number; time?: string; startTime?: string; endTime?: string }>;
  status: string;
};

type Student = {
  id: number;
  groupId?: number;
  groupName?: string;
  groupIds?: number[];
  groupNames?: string[];
  courseName?: string;
  studentName?: string;
  contactName: string;
  attendancePercent: number;
  progressPercent: number;
  status: string;
};

type LessonSurvey = {
  id: number;
  studentId: number;
  studentName?: string;
  lessonId: number;
  lessonTopic?: string;
  groupId?: number;
  groupName?: string;
  teacherId?: number;
  courseId?: number;
  score: number;
  liked?: string;
  improve?: string;
  createdAt: string;
};

type AttendanceRecord = {
  lessonId: number;
  studentId: number;
  status: 'present' | 'absent';
  note?: string | null;
};

type AttendanceDraft = Record<number, 'present' | 'absent'>;

type SaveAttendanceVariables = {
  lessonId: number;
  roster: Array<Pick<Student, 'id'>>;
  draft: AttendanceDraft;
  note?: string;
};

type RescheduleLessonVariables = {
  lessonId: number;
  payload: {
    scheduledAt: string;
    reason: string;
  };
};

const ACADEMY_TIME_ZONE = 'Asia/Tashkent';

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

function formatScheduleTime(item: { time?: string; startTime?: string; endTime?: string }): string {
  const start = item.startTime || item.time || '';
  return item.endTime && item.endTime !== start ? `${start}–${item.endTime}` : start;
}

function getInitials(name?: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function EmptyState({
  title,
  text,
  icon: Icon = BarChart3,
}: {
  title: string;
  text: string;
  icon?: any;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-14 px-6 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
          <Icon className="h-7 w-7 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">{text}</p>
      </CardContent>
    </Card>
  );
}

function isToday(dateStr: string): boolean {
  return localDateKey(dateStr) === localDateKey(new Date().toISOString());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ru-RU', {
    timeZone: ACADEMY_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ru-RU', {
    timeZone: ACADEMY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ru-RU', {
    timeZone: ACADEMY_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function TeacherModule({ section = 'overview' }: { section?: TeacherSection }) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const dayNames = [
    t('mondayShort'),
    t('tuesdayShort'),
    t('wednesdayShort'),
    t('thursdayShort'),
    t('fridayShort'),
    t('saturdayShort'),
    t('sundayShort'),
  ];
  const dayNamesFull = [
    t('monday'),
    t('tuesday'),
    t('wednesday'),
    t('thursday'),
    t('friday'),
    t('saturday'),
    t('sunday'),
  ];

  // Attendance state
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceDraft>({});
  const [attendanceNote, setAttendanceNote] = useState('');
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [pendingLessonSwitch, setPendingLessonSwitch] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const attendanceDraftDirty = useRef(false);
  const attendanceNoteDirty = useRef(false);
  const hydratedAttendanceLessonId = useRef<number | null>(null);

  useEffect(() => {
    if (section !== 'attendance') return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [section]);

  // Group detail dialog
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [reportingRange, setReportingRange] = useState(() => reportingRangeForPreset('thisMonth'));
  const { data, isLoading, isError, error, refetch } = useQuery<any>({
    queryKey: ['/api/academy/modules/teacher'],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/modules/teacher'] });

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
    onError: (error: any) =>
      toast({ title: t('error'), description: error.message, variant: 'destructive' }),
  });

  // Derived data
  const groups: Group[] = useMemo(() => data?.groups ?? [], [data]);
  const lessons: Lesson[] = useMemo(() => data?.lessons ?? [], [data]);
  const students: Student[] = useMemo(() => data?.students ?? [], [data]);
  const surveys: LessonSurvey[] = useMemo(() => data?.lessonSurveys ?? [], [data]);
  const attendanceRecords: AttendanceRecord[] = useMemo(() => data?.attendance ?? [], [data]);
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
    () => groups.reduce((sum, g) => sum + (g.currentStudents || 0), 0),
    [groups]
  );

  const todayLessons = useMemo(
    () => lessons.filter((l) => isToday(l.scheduledAt)),
    [lessons]
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
  const periodSurveys = useMemo(
    () => surveys.filter((survey) => periodLessonIds.has(Number(survey.lessonId))),
    [periodLessonIds, surveys],
  );

  const avgAttendance = useMemo(() => {
    if (!periodAttendanceRecords.length) return null;
    const presentCount = periodAttendanceRecords.filter((record) => record.status === 'present').length;
    return Math.round((presentCount / periodAttendanceRecords.length) * 100);
  }, [periodAttendanceRecords]);

  const avgLessonRating = useMemo(() => {
    if (!periodSurveys.length) return null;
    const sum = periodSurveys.reduce((acc, survey) => acc + survey.score, 0);
    return (sum / periodSurveys.length).toFixed(1);
  }, [periodSurveys]);

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
      const groupSurveys = periodSurveys.filter((survey) => lessonIds.has(Number(survey.lessonId)));
      const averageRating = groupSurveys.length > 0
        ? groupSurveys.reduce((sum, survey) => sum + Number(survey.score || 0), 0) / groupSurveys.length
        : null;
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
        rating: averageRating == null ? null : Math.round((averageRating / 5) * 100),
      }];
    });
    return compactRankedSeries(rows, (row) => row.lessonVolume, 6);
  }, [groups, periodAttendanceRecords, periodLessons, periodSurveys]);

  const attendanceDistribution = useMemo(() => [
    {
      name: t('present'),
      value: periodAttendanceRecords.filter((record) => record.status === 'present').length,
      color: 'var(--chart-1)',
    },
    {
      name: t('absent'),
      value: periodAttendanceRecords.filter((record) => record.status === 'absent').length,
      color: 'var(--chart-5)',
    },
  ], [periodAttendanceRecords, t]);

  const ratingDistribution = useMemo(
    () => [1, 2, 3, 4, 5].map((score) => ({
      score: `${score}★`,
      count: periodSurveys.filter((survey) => Number(survey.score) === score).length,
    })),
    [periodSurveys],
  );

  // Schedule: show today first, followed by the next six academy days.
  const scheduleByDay = useMemo(() => {
    const lessonsByDate = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const dateKey = localDateKey(lesson.scheduledAt);
      const dayLessons = lessonsByDate.get(dateKey) ?? [];
      dayLessons.push(lesson);
      lessonsByDate.set(dateKey, dayLessons);
    }

    return buildTeacherScheduleDays(new Date(), ACADEMY_TIME_ZONE).map((day) => ({
      ...day,
      lessons: [...(lessonsByDate.get(day.dateKey) ?? [])].sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      ),
    }));
  }, [lessons]);

  // Attendance
  const selectedLesson = useMemo(
    () => lessons.find((l) => String(l.id) === selectedLessonId),
    [lessons, selectedLessonId]
  );

  const attendanceLessons = useMemo(
    () => sortAttendanceLessons(lessons, now),
    [lessons, now],
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
    lesson: Lesson;
    students: Student[];
    attendance: AttendanceRecord[];
  }>({
    queryKey: ['/api/academy/lessons', Number(selectedLessonId), 'attendance-roster'],
    queryFn: () => apiRequest('GET', `/api/academy/lessons/${selectedLessonId}/attendance-roster`),
    enabled: Boolean(selectedLessonId),
  });
  const selectedLessonDetails = selectedLesson
    ? { ...selectedLesson, ...(attendanceRosterQuery.data?.lesson ?? {}) }
    : attendanceRosterQuery.data?.lesson;

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
      queryClient.invalidateQueries({
        queryKey: ['/api/academy/lessons', variables.lessonId, 'attendance-roster'],
      });
      invalidate();
    },
    onError: (error: Error) => toast({
      title: t('error'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  useEffect(() => {
    if (!selectedLessonDetails) {
      setRescheduleAt('');
      setRescheduleReason('');
      return;
    }
    const currentDate = new Date(selectedLessonDetails.scheduledAt);
    const suggestedDate = new Date(Math.max(
      currentDate.getTime() + 7 * 24 * 60 * 60 * 1000,
      Date.now() + 60 * 60 * 1000,
    ));
    setRescheduleAt(toDateTimeLocal(suggestedDate));
    setRescheduleReason('');
  }, [selectedLessonDetails?.id, selectedLessonDetails?.scheduledAt]);

  const selectedLessonStudents = useMemo(() => {
    if (!selectedLesson) return [];
    return attendanceRosterQuery.data?.students ?? [];
  }, [attendanceRosterQuery.data?.students, selectedLesson]);

  const selectedAttendanceRecords = useMemo(() => {
    if (!selectedLesson) return [];
    return attendanceRosterQuery.data?.attendance ?? [];
  }, [attendanceRosterQuery.data?.attendance, selectedLesson]);

  const attendanceHydrationKey = useMemo(() => JSON.stringify({
    lessonId: selectedLesson?.id ?? null,
    studentIds: selectedLessonStudents.map((student) => student.id),
    records: selectedAttendanceRecords.map((record) => [record.studentId, record.status, record.note ?? '']),
  }), [selectedAttendanceRecords, selectedLesson?.id, selectedLessonStudents]);

  useEffect(() => {
    if (!selectedLesson) {
      setAttendanceDraft({});
      setAttendanceNote('');
      attendanceNoteDirty.current = false;
      return;
    }

    const changedLesson = hydratedAttendanceLessonId.current !== selectedLesson.id;
    if (!changedLesson && attendanceDraftDirty.current) return;

    const studentIds = new Set(selectedLessonStudents.map((student) => student.id));
    const nextDraft: Record<number, 'present' | 'absent'> = {};
    for (const record of selectedAttendanceRecords) {
      if (studentIds.has(record.studentId) && (record.status === 'present' || record.status === 'absent')) {
        nextDraft[record.studentId] = record.status;
      }
    }
    setAttendanceDraft(nextDraft);
    setAttendanceNote(selectedAttendanceRecords.find((record) => record.note?.trim())?.note ?? '');
    hydratedAttendanceLessonId.current = selectedLesson.id;
    attendanceDraftDirty.current = false;
    attendanceNoteDirty.current = false;
  }, [attendanceHydrationKey]);

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

  // Survey data grouped by group
  const surveyGroups = useMemo(() => {
    const byGroup: Record<number, { surveys: LessonSurvey[]; avgScore: number }> = {};
    surveys.forEach((s) => {
      const gid = s.groupId || 0;
      if (!byGroup[gid]) byGroup[gid] = { surveys: [], avgScore: 0 };
      byGroup[gid].surveys.push(s);
    });
    Object.keys(byGroup).forEach((gid) => {
      const arr = byGroup[Number(gid)].surveys;
      byGroup[Number(gid)].avgScore =
        Math.round((arr.reduce((a, b) => a + b.score, 0) / arr.length) * 10) / 10;
    });
    return byGroup;
  }, [surveys]);

  // Teacher courses
  const teacherCourses = useMemo(() => {
    const courseIds = new Set<number>();
    groups.forEach((g) => {
      if (g.courseId) courseIds.add(g.courseId);
    });
    return data?.courses?.filter((c: any) => courseIds.has(c.id)) ?? [];
  }, [groups, data]);

  // Chart data for ratings over time
  const ratingChartData = useMemo(() => {
    const byDate: Record<string, { total: number; count: number }> = {};
    surveys.forEach((s) => {
      const date = localDateKey(s.createdAt);
      if (!byDate[date]) byDate[date] = { total: 0, count: 0 };
      byDate[date].total += s.score;
      byDate[date].count += 1;
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, { total, count }]) => ({
        date: new Date(`${date}T00:00:00`).toLocaleDateString('ru-RU'),
        avgScore: Math.round((total / count) * 10) / 10,
        count,
      }));
  }, [surveys]);

  const contained = section !== 'overview';

  const fullName = user?.fullName || t('teacher');
  const sectionTitle: Record<TeacherSection, string> = {
    overview: t(moduleSectionLabelKey('teacher', 'overview')),
    schedule: t(moduleSectionLabelKey('teacher', 'schedule')),
    groups: t(moduleSectionLabelKey('teacher', 'groups')),
    attendance: t(moduleSectionLabelKey('teacher', 'attendance')),
    ratings: t('lessonRatings'),
  };

  const getLessonStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      scheduled: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300',
      conducted: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300',
      cancelled: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300',
      postponed: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300',
    };
    return (
      <Badge className={cn('text-xs font-medium', variants[status] || 'bg-muted text-muted-foreground')}>
        {status === 'scheduled' && t('lessonStatusScheduled')}
        {status === 'conducted' && t('lessonStatusConducted')}
        {status === 'cancelled' && t('lessonStatusCancelled')}
        {status === 'postponed' && t('lessonStatusPostponed')}
        {!['scheduled', 'conducted', 'cancelled', 'postponed'].includes(status) && status}
      </Badge>
    );
  };

  const getGroupStatusBadge = (status: string) => {
    const labels: Record<string, string> = {
      open: t('groupStatusOpen'),
      in_progress: t('groupStatusInProgress'),
      completed: t('groupStatusCompleted'),
    };
    const classes: Record<string, string> = {
      open: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300',
      in_progress: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300',
      completed: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300',
    };
    return (
      <Badge className={cn('text-xs font-medium', classes[status] || 'bg-muted text-muted-foreground')}>
        {labels[status] ?? status}
      </Badge>
    );
  };

  const handleToggleAttendance = (studentId: number, status: 'present' | 'absent') => {
    if (lessonMutationPending) return;
    attendanceDraftDirty.current = true;
    setAttendanceDraft((prev) => ({ ...prev, [studentId]: status }));
  };

  const handleSetAllAttendance = (status: 'present' | 'absent') => {
    if (lessonMutationPending) return;
    attendanceDraftDirty.current = true;
    const update: AttendanceDraft = {};
    selectedLessonStudents.forEach((s) => {
      update[s.id] = status;
    });
    setAttendanceDraft(update);
  };

  const handleSaveAttendance = () => {
    if (!selectedLesson || !canSaveAttendance || lessonMutationPending) return;
    saveAttendance.mutate({
      lessonId: selectedLesson.id,
      roster: selectedLessonStudents.map(({ id }) => ({ id })),
      draft: { ...attendanceDraft },
      note: attendanceNoteDirty.current ? attendanceNote : undefined,
    });
  };

  const handleRescheduleLesson = () => {
    if (!selectedLessonDetails || !parsedRescheduleAt || !canRescheduleLesson || lessonMutationPending) return;
    rescheduleLesson.mutate({
      lessonId: selectedLessonDetails.id,
      payload: {
        scheduledAt: parsedRescheduleAt.toISOString(),
        reason: rescheduleReason.trim(),
      },
    });
  };

  const [isAttendanceDialogOpen, setAttendanceDialogOpen] = useState(false);
  const [pendingDialogClose, setPendingDialogClose] = useState(false);

  const openAttendanceDialog = useCallback((lessonId: string) => {
    attendanceDraftDirty.current = false;
    attendanceNoteDirty.current = false;
    setSelectedLessonId(lessonId);
    setAttendanceDraft({});
    setAttendanceNote('');
    setAttendanceDialogOpen(true);
  }, []);

  const handleLessonSelect = useCallback((lessonId: string) => {
    if (lessonMutationPending) return;
    if (isAttendanceDialogOpen && attendanceDraftDirty.current && selectedLessonId) {
      setPendingLessonSwitch(lessonId);
      return;
    }
    openAttendanceDialog(lessonId);
  }, [isAttendanceDialogOpen, lessonMutationPending, openAttendanceDialog, selectedLessonId]);

  const handleDialogCloseRequest = useCallback((open: boolean) => {
    if (!open) {
      if (attendanceDraftDirty.current) {
        setPendingDialogClose(true);
        return;
      }
      setAttendanceDialogOpen(false);
      attendanceDraftDirty.current = false;
      attendanceNoteDirty.current = false;
    }
  }, []);

  const confirmDialogClose = useCallback(() => {
    setPendingDialogClose(false);
    setAttendanceDialogOpen(false);
    attendanceDraftDirty.current = false;
    attendanceNoteDirty.current = false;
  }, []);

  const confirmLessonSwitch = useCallback(() => {
    if (pendingLessonSwitch) {
      openAttendanceDialog(pendingLessonSwitch);
      setPendingLessonSwitch(null);
    }
  }, [openAttendanceDialog, pendingLessonSwitch]);

  const cancelLessonSwitch = useCallback(() => {
    setPendingLessonSwitch(null);
  }, []);

  // Protect against accidental page close with unsaved attendance data
  useEffect(() => {
    if (section !== 'attendance') return;
    const handler = (event: BeforeUnloadEvent) => {
      if (attendanceDraftDirty.current) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [section]);

  const attendanceSummary = useMemo(() => {
    const total = selectedLessonStudents.length;
    let marked = 0;
    let present = 0;
    let absent = 0;
    for (const student of selectedLessonStudents) {
      const status = attendanceDraft[student.id];
      if (status) {
        marked += 1;
        if (status === 'present') present += 1;
        else absent += 1;
      }
    }
    return { total, marked, present, absent };
  }, [selectedLessonStudents, attendanceDraft]);

  if (isError) {
    return (
      <ModulePage contained={contained}>
        <ModulePageBody contained={contained} ariaLabel={t('failedToLoadData')}>
          <div className="mx-auto max-w-xl space-y-4 text-center">
            <p className="font-medium text-destructive">{t('error')}</p>
            <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : t('failedToLoadData')}</p>
            <Button variant="outline" onClick={() => refetch()}>{t('retry')}</Button>
          </div>
        </ModulePageBody>
      </ModulePage>
    );
  }

  if (isLoading || !data) {
    return (
      <ModulePage contained={contained}>
        <ModulePageBody contained={contained} ariaLabel={t('loading')}>
          <div className="space-y-6">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-6 w-48" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <AnalyticsChartsSkeleton />
          </div>
        </ModulePageBody>
      </ModulePage>
    );
  }

  return (
    <ModulePage contained={contained} className={contained ? undefined : 'space-y-5'}>
      <PageHeader
        title={sectionTitle[section]}
        subtitle={section === 'overview'
          ? `${t('hello')}, ${fullName}`
          : t(MODULE_NAVIGATION.teacher.nameKey)}
        breadcrumbs={[
          { label: t(MODULE_NAVIGATION.teacher.nameKey), href: '/teacher-module' },
          ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
        ]}
      />

      {section === 'overview' ? (
        <ReportingDateRangeFilter value={reportingRange} onChange={setReportingRange} />
      ) : null}

      {/* KPI overview — visual charts instead of plain number tiles */}
      {section === 'overview' ? (
        <TeacherOverviewKpis
          data={{
            groupsCount: groups.length,
            courseNames: teacherCourses.map((c: any) => c.name).join(', ') || t('noData'),
            totalStudents,
            totalCapacity: groups.reduce((sum, group) => sum + (group.maxStudents || 12), 0),
            conductedLessons: conductedPeriodLessons.length,
            totalLessons: periodLessons.length,
            avgAttendance,
            avgRating: avgLessonRating == null ? null : Number(avgLessonRating),
            teachingHours: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(teachingHours),
          }}
        />
      ) : null}

      {section === 'overview' ? (
        <TeacherAnalyticsCharts
          timeline={teacherTimeline}
          groupQuality={groupQuality}
          attendance={attendanceDistribution}
          ratings={ratingDistribution}
        />
      ) : null}

      <ModulePageBody contained={contained} ariaLabel={sectionTitle[section]}>
      {section !== 'overview' ? (
      <Tabs value={section}>
        {/* Schedule Tab */}
        <TabsContent value="schedule" className="mt-6 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
            {scheduleByDay.map((day) => {
              const isTodayFlag = day.dateKey === localDateKey(new Date().toISOString());
              return (
                <Card
                  key={day.dateKey}
                  className={cn(
                    'border-border/70',
                    isTodayFlag && 'ring-2 ring-primary-500/30 border-primary-300'
                  )}
                >
                  <CardHeader className="pb-3 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold">
                        {dayNames[day.weekdayIndex]}
                      </CardTitle>
                      {isTodayFlag && (
                        <Badge className="bg-primary-100 text-xs text-primary-700">
                          {t('now')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {day.date.toLocaleDateString('ru-RU', {
                        timeZone: 'UTC',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {day.lessons.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">{t('noLessonsToday')}</p>
                    )}
                    {day.lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className={cn(
                          'rounded-lg border p-2.5 text-xs space-y-1 transition-all hover:shadow-sm',
                          isToday(lesson.scheduledAt)
                            ? 'bg-blue-50/60 border-blue-200/70'
                            : 'border-border/50 bg-muted/40'
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-foreground">{formatTime(lesson.scheduledAt)}</span>
                          {getLessonStatusBadge(lesson.status)}
                        </div>
                        <p className="text-foreground font-medium truncate">{lesson.groupName || t('noGroup')}</p>
                        <p className="text-muted-foreground truncate">{lesson.topic}</p>
                        {lesson.status === 'conducted' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-1 min-h-9 px-2 text-xs text-primary-600 hover:text-primary-700"
                            onClick={() => {
                              setSelectedLessonId(String(lesson.id));
                              setLocation('/teacher-module/attendance');
                            }}
                          >
                            {t('attendanceLabel')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Today's lessons list */}
          {todayLessons.length > 0 && (
            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">{t('todayLessons')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[...todayLessons]
                  .sort(
                    (a, b) =>
                      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
                  )
                  .map((lesson) => (
                    <div
                      key={lesson.id}
                      className="flex items-center justify-between rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-sm font-semibold text-foreground tabular-nums">
                          {formatTime(lesson.scheduledAt)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {lesson.groupName || t('noGroup')} • {lesson.topic}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {lesson.courseName || t('noCourse')} • {lesson.durationMinutes}
                            {t('minutes')} • {lesson.schoolName || t('schoolNotSelected')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getLessonStatusBadge(lesson.status)}
                        {lesson.status === 'scheduled' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setSelectedLessonId(String(lesson.id));
                              setLocation('/teacher-module/attendance');
                            }}
                          >
                            {t('attendanceChecklist')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Groups Tab */}
        <TabsContent value="groups" className="mt-6 space-y-4">
          {selectedGroup ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => setSelectedGroup(null)}>
                  {t('backToGroups')}
                </Button>
              </div>
              <Card className="border-border/70">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{selectedGroup.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {selectedGroup.courseName || t('noCourse')} • {t('teacher')}: {user?.fullName}
                      </p>
                    </div>
                    {getGroupStatusBadge(selectedGroup.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">{t('lessonProgress')}</span>
                      <span className="font-medium text-foreground">
                        {t('lessonsConductedCount')
                          .replace('{conducted}', String(groupLessonProgressById.get(selectedGroup.id)?.conducted ?? 0))
                          .replace('{total}', String(groupLessonProgressById.get(selectedGroup.id)?.total ?? 0))}
                      </span>
                    </div>
                    <Progress
                      value={
                        ((groupLessonProgressById.get(selectedGroup.id)?.conducted ?? 0)
                          / Math.max(groupLessonProgressById.get(selectedGroup.id)?.total ?? 0, 1))
                        * 100
                      }
                    />
                  </div>

                  {selectedGroup.schedule && selectedGroup.schedule.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedGroup.schedule.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {dayNamesFull[s.dayOfWeek - 1] || ''} {formatScheduleTime(s)}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-sm font-semibold mb-3">
                      {t('groupStudents')} ({groupStudents.length})
                    </h4>
                    <DataTable
                      columns={[
                        {
                          key: 'studentName',
                          header: t('studentName'),
                          accessor: (row) => row.studentName || row.contactName,
                        },
                        {
                          key: 'attendedLessons',
                          header: t('attendedLessons'),
                          accessor: (row) => selectedGroupAttendanceByStudentId.get(row.id)?.attended ?? 0,
                          sortable: true,
                          className: 'text-center',
                          cellClassName: 'text-center',
                          render: (row) => (
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 tabular-nums">
                              {selectedGroupAttendanceByStudentId.get(row.id)?.attended ?? 0}
                            </Badge>
                          ),
                        },
                        {
                          key: 'missedLessons',
                          header: t('missedLessons'),
                          accessor: (row) => selectedGroupAttendanceByStudentId.get(row.id)?.missed ?? 0,
                          sortable: true,
                          className: 'text-center',
                          cellClassName: 'text-center',
                          render: (row) => (
                            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 tabular-nums">
                              {selectedGroupAttendanceByStudentId.get(row.id)?.missed ?? 0}
                            </Badge>
                          ),
                        },
                      ]}
                      data={groupStudents}
                      keyExtractor={(row) => String(row.id)}
                      emptyState={
                        <EmptyState
                          title={t('noStudents')}
                          text={t('noStudentsInGroup')}
                          icon={Users}
                        />
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {groups.map((group) => (
                <Card
                  key={group.id}
                  className="border-border/70 hover-lift cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  onClick={() => setSelectedGroup(group)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setSelectedGroup(group);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-foreground group-hover:text-primary-600 transition-colors">
                          {group.name}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {group.courseName || t('noCourse')} · {group.schoolName || t('schoolNotSelected')}
                        </p>
                      </div>
                      {getGroupStatusBadge(group.status)}
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-muted-foreground">{t('lessonProgress')}</span>
                        <span className="text-foreground font-medium">
                          {t('lessonsConductedCount')
                            .replace('{conducted}', String(groupLessonProgressById.get(group.id)?.conducted ?? 0))
                            .replace('{total}', String(groupLessonProgressById.get(group.id)?.total ?? 0))}
                        </span>
                      </div>
                      <Progress
                        value={
                          ((groupLessonProgressById.get(group.id)?.conducted ?? 0)
                            / Math.max(groupLessonProgressById.get(group.id)?.total ?? 0, 1))
                          * 100
                        }
                        className="h-2"
                      />
                    </div>

                    {group.schedule && group.schedule.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {group.schedule.map((s, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {dayNames[s.dayOfWeek - 1] || ''} {formatScheduleTime(s)}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span>{group.currentStudents || 0} {t('studentsCount')}</span>
                      </div>
                      <span className="text-xs text-primary-600 font-medium">{t('details')}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {groups.length === 0 && (
                <EmptyState
                  title={t('noGroups')}
                  text={t('noGroupsAssigned')}
                  icon={Users}
                />
              )}
            </div>
          )}
        </TabsContent>

        {/* Attendance Tab */}
        <TabsContent value="attendance" className="mt-6 space-y-4">
          {/* Unsaved changes confirmation for lesson switch */}
          <AlertDialog open={pendingLessonSwitch !== null} onOpenChange={(open) => { if (!open) cancelLessonSwitch(); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-amber-500" />
                  {t('unsavedAttendanceTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('unsavedAttendanceDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={cancelLessonSwitch}>{t('keepEditing')}</AlertDialogCancel>
                <AlertDialogAction onClick={confirmLessonSwitch} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {t('discardChanges')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Unsaved changes confirmation for dialog close */}
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
                <AlertDialogCancel onClick={() => setPendingDialogClose(false)}>{t('keepEditing')}</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDialogClose} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {t('discardChanges')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Main Full-Width Calendar */}
          <AttendanceCalendar
            lessons={attendanceLessons}
            selectedLessonId={selectedLessonId}
            now={now}
            disabled={lessonMutationPending}
            onSelectLesson={handleLessonSelect}
          />

          {/* Attendance Checklist Modal Dialog */}
          <Dialog open={isAttendanceDialogOpen} onOpenChange={handleDialogCloseRequest}>
            <DialogContent className="max-h-[90vh] max-w-3xl gap-0 overflow-hidden p-0 rounded-2xl border-border/60 shadow-2xl bg-background">
              {/* Top Header */}
              <div className="relative border-b border-border/60 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-xs ring-1 ring-primary/20">
                      <ClipboardCheck className="size-6" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-semibold bg-background/80 backdrop-blur-xs border-primary/30 text-primary px-2.5 py-0.5 text-xs">
                          {selectedLessonDetails?.groupName || t('noGroup')}
                        </Badge>
                        {selectedLessonDetails && getLessonStatusBadge(selectedLessonDetails.status)}
                      </div>
                      <h2 className="text-xl font-bold tracking-tight text-foreground truncate">
                        {selectedLessonDetails?.topic || t('attendanceChecklist')}
                      </h2>
                      {selectedLessonDetails && (
                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-0.5">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Calendar className="size-3.5 text-primary" />
                            {formatDateFull(selectedLessonDetails.scheduledAt)}
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Clock3 className="size-3.5 text-primary" />
                            {formatTime(selectedLessonDetails.scheduledAt)} ({selectedLessonDetails.durationMinutes} {t('minutes')})
                          </span>
                          {selectedLessonDetails.courseName && (
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <BookOpen className="size-3.5 text-primary" />
                              {selectedLessonDetails.courseName}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Scrollable Content Body */}
              <div className="max-h-[calc(90vh-180px)] overflow-y-auto p-6 space-y-6">
                {/* Loading state */}
                {selectedLesson && attendanceRosterQuery.isPending && (
                  <div className="space-y-4 py-4">
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-10 w-64 rounded-lg" />
                    <div className="space-y-3">
                      <Skeleton className="h-16 w-full rounded-xl" />
                      <Skeleton className="h-16 w-full rounded-xl" />
                      <Skeleton className="h-16 w-full rounded-xl" />
                    </div>
                  </div>
                )}

                {/* Error state */}
                {selectedLesson && attendanceRosterQuery.isError && (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                    <div className="mx-auto size-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-3">
                      <AlertTriangle className="size-6" />
                    </div>
                    <p className="text-base font-semibold text-destructive">{t('attendanceRosterLoadFailed')}</p>
                    <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
                      {attendanceRosterQuery.error instanceof Error
                        ? attendanceRosterQuery.error.message
                        : t('failedToLoadData')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-4 rounded-xl px-5"
                      disabled={lessonMutationPending}
                      onClick={() => attendanceRosterQuery.refetch()}
                    >
                      {t('retry')}
                    </Button>
                  </div>
                )}

                {/* Loaded state */}
                {selectedLesson
                  && !attendanceRosterQuery.isPending
                  && !attendanceRosterQuery.isError && (
                  <>
                    {/* KPI Summary Toolbar & Quick Actions */}
                    {selectedLessonStudents.length > 0 && (
                      <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3 shadow-xs">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap text-xs font-medium">
                            <Badge variant="secondary" className="bg-background text-foreground border border-border/60 px-3 py-1 font-semibold">
                              {t('attendanceMarkedOf').replace('{marked}', String(attendanceSummary.marked)).replace('{total}', String(attendanceSummary.total))}
                            </Badge>
                            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 px-3 py-1 font-semibold">
                              {t('attendancePresentCount').replace('{count}', String(attendanceSummary.present))}
                            </Badge>
                            <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 px-3 py-1 font-semibold">
                              {t('attendanceAbsentCount').replace('{count}', String(attendanceSummary.absent))}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg text-xs font-medium border-emerald-300/70 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40"
                              disabled={lessonMutationPending}
                              onClick={() => handleSetAllAttendance('present')}
                            >
                              <CheckCircle2 className="size-3.5 mr-1.5 text-emerald-500" />
                              {t('allPresent')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg text-xs font-medium border-rose-300/70 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                              disabled={lessonMutationPending}
                              onClick={() => handleSetAllAttendance('absent')}
                            >
                              <XCircle className="size-3.5 mr-1.5 text-rose-500" />
                              {t('allAbsent')}
                            </Button>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1">
                          <Progress
                            value={attendanceSummary.total > 0 ? (attendanceSummary.marked / attendanceSummary.total) * 100 : 0}
                            className="h-2 rounded-full bg-muted"
                          />
                        </div>
                      </div>
                    )}

                    {/* Student Roster Cards */}
                    {selectedLessonStudents.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between px-1">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            {t('groupStudents')} ({selectedLessonStudents.length})
                          </h3>
                        </div>

                        <div className="space-y-2.5">
                          {selectedLessonStudents.map((student) => {
                            const status = attendanceDraft[student.id];
                            const percent = student.attendancePercent || 0;
                            const percentTone = percent >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : percent >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-rose-600 bg-rose-50 border-rose-200';

                            return (
                              <div
                                key={student.id}
                                className={cn(
                                  'group flex items-center justify-between gap-4 rounded-xl border p-3 sm:p-4 transition-all duration-200 shadow-2xs',
                                  status === 'present' && 'border-emerald-500/40 bg-emerald-500/[0.04]',
                                  status === 'absent' && 'border-rose-500/40 bg-rose-500/[0.04]',
                                  !status && 'border-border/60 bg-card hover:border-border',
                                )}
                              >
                                <div className="flex items-center gap-3.5 min-w-0">
                                  <div className={cn(
                                    'flex size-10 shrink-0 items-center justify-center rounded-xl font-bold text-xs border transition-colors',
                                    status === 'present' && 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
                                    status === 'absent' && 'bg-rose-500/10 text-rose-700 border-rose-500/30',
                                    !status && 'bg-primary/10 text-primary border-primary/20',
                                  )}>
                                    {getInitials(student.studentName || student.contactName)}
                                  </div>
                                  <div className="min-w-0 space-y-0.5">
                                    <p className="text-sm font-semibold text-foreground truncate">
                                      {student.studentName || student.contactName}
                                    </p>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium border tabular-nums', percentTone)}>
                                        {percent}% {t('attendanceLabel').toLowerCase()}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Segmented Control Buttons */}
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    disabled={lessonMutationPending}
                                    onClick={() => handleToggleAttendance(student.id, 'present')}
                                    className={cn(
                                      'inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-150 border',
                                      'active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
                                      status === 'present'
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                                        : 'bg-background text-muted-foreground border-border/80 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50/50',
                                    )}
                                  >
                                    <CheckCircle2 className="size-4 mr-1.5" />
                                    {t('present')}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={lessonMutationPending}
                                    onClick={() => handleToggleAttendance(student.id, 'absent')}
                                    className={cn(
                                      'inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-150 border',
                                      'active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
                                      status === 'absent'
                                        ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20'
                                        : 'bg-background text-muted-foreground border-border/80 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50/50',
                                    )}
                                  >
                                    <XCircle className="size-4 mr-1.5" />
                                    {t('absent')}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Empty Group State */}
                    {selectedLessonStudents.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center bg-muted/10">
                        <div className="mx-auto size-12 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-3">
                          <Users className="size-6" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">{t('noStudents')}</h3>
                        <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">{t('noStudentsInGroup')}</p>
                      </div>
                    )}

                    {/* Reschedule Lesson Section */}
                    {selectedLessonDetails && ['scheduled', 'conducted'].includes(selectedLessonDetails.status) && (
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-3">
                        <div
                          className="flex items-center justify-between cursor-pointer select-none"
                          onClick={() => setIsRescheduleOpen(!isRescheduleOpen)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="size-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                              <Calendar className="size-4" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-foreground">{t('rescheduleLesson')}</h4>
                              <p className="text-[11px] text-muted-foreground">{t('rescheduleLessonHint')}</p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            aria-label={t('rescheduleLesson')}
                            aria-expanded={isRescheduleOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              setIsRescheduleOpen((open) => !open);
                            }}
                          >
                            {isRescheduleOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </Button>
                        </div>

                        {isRescheduleOpen && (
                          <div className="pt-2 space-y-3 border-t border-amber-500/20">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label htmlFor="reschedule-at" className="text-xs font-medium text-muted-foreground">
                                  {t('newLessonDate')}
                                </Label>
                                <Input
                                  id="reschedule-at"
                                  type="datetime-local"
                                  min={toDateTimeLocal(new Date(now + 5 * 60 * 1000))}
                                  value={rescheduleAt}
                                  disabled={lessonMutationPending}
                                  onChange={(event) => setRescheduleAt(event.target.value)}
                                  className="h-9 text-xs rounded-lg"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="reschedule-reason" className="text-xs font-medium text-muted-foreground">
                                  {t('rescheduleReason')}
                                </Label>
                                <Input
                                  id="reschedule-reason"
                                  value={rescheduleReason}
                                  maxLength={500}
                                  disabled={lessonMutationPending}
                                  onChange={(event) => setRescheduleReason(event.target.value)}
                                  placeholder={t('rescheduleReasonPlaceholder')}
                                  className="h-9 text-xs rounded-lg"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg text-xs font-medium border-amber-300 text-amber-800 hover:bg-amber-100"
                                onClick={handleRescheduleLesson}
                                disabled={!canRescheduleLesson || lessonMutationPending}
                              >
                                <Calendar className="size-3.5 mr-1.5" />
                                {rescheduleLesson.isPending ? t('saving') : t('rescheduleLesson')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Comment / Note Section */}
                    {selectedLessonStudents.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground">{t('comment')}</Label>
                        <Textarea
                          value={attendanceNote}
                          disabled={lessonMutationPending}
                          onChange={(e) => {
                            attendanceDraftDirty.current = true;
                            attendanceNoteDirty.current = true;
                            setAttendanceNote(e.target.value);
                          }}
                          placeholder={t('attendanceNotePlaceholder')}
                          rows={2}
                          className="rounded-xl text-sm"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Sticky Footer */}
              {selectedLesson && !attendanceRosterQuery.isPending && !attendanceRosterQuery.isError && selectedLessonStudents.length > 0 && (
                <div className="border-t border-border/60 bg-background/95 backdrop-blur-md p-4 sm:p-5 space-y-3">
                  {selectedLessonDetails?.status === 'scheduled' && !selectedLessonHasStarted && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <Clock3 className="size-4 shrink-0 text-amber-600" />
                      <span>{t('attendanceAvailableAfterLessonStart')}</span>
                    </div>
                  )}
                  {previousIncompleteLesson && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                      <span>{t('previousLessonMustBeCompleted')}</span>
                    </div>
                  )}

                  <Button
                    className="w-full h-11 text-sm font-bold rounded-xl bg-gradient-to-r from-primary-600 via-primary to-primary-700 hover:brightness-105 active:scale-[0.99] transition-all shadow-md shadow-primary/25"
                    onClick={handleSaveAttendance}
                    disabled={lessonMutationPending || !canSaveAttendance}
                  >
                    {saveAttendance.isPending
                      ? t('saving')
                      : selectedLessonDetails?.status === 'conducted'
                        ? t('updateAttendance')
                        : t('finishLessonAndSaveAttendance')}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Ratings Tab */}
        <TabsContent value="ratings" className="mt-6 space-y-4">
          {/* Average rating by group */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(surveyGroups).map(([gid, { surveys: groupSurveys, avgScore }]) => {
              const group = groups.find((g) => g.id === Number(gid));
              return (
                <Card key={gid} className="border-border/70">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground truncate">
                          {group?.name || t('noGroup')}
                        </p>
                        <div className="mt-1.5 text-[26px] font-bold text-foreground leading-tight tabular-nums">
                          {avgScore}
                          <span className="text-sm text-muted-foreground ml-1">/ 5</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {groupSurveys.length}{' '}
                          {groupSurveys.length === 1
                            ? t('ratingsCount')
                            : groupSurveys.length < 5
                            ? t('ratingsCount')
                            : t('ratingsCount')}
                        </p>
                      </div>
                      <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 bg-amber-50 text-amber-600">
                        <Star className="h-5 w-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {Object.keys(surveyGroups).length === 0 && (
              <div className="md:col-span-3">
                <EmptyState
                  title={t('noGrades')}
                  text={t('noLessonRatingsYet')}
                  icon={Star}
                />
              </div>
            )}
          </div>

          {/* Rating chart over time */}
          {ratingChartData.length > 1 && (
            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  {t('ratingDynamics')}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <DataTable
                  columns={[
                    {
                      key: 'date',
                      header: t('dateColumn'),
                      accessor: (row) => row.date,
                    },
                    {
                      key: 'avgScore',
                      header: t('averageScore'),
                      accessor: (row) => row.avgScore,
                      render: (row) => (
                        <div className="flex items-center gap-2">
                          <div className="flex">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={cn(
                                  'h-3.5 w-3.5',
                                  i < Math.round(row.avgScore)
                                    ? 'text-amber-400 fill-amber-400'
                                    : 'text-slate-200'
                                )}
                              />
                            ))}
                          </div>
                          <span className="font-medium text-foreground">{row.avgScore}</span>
                        </div>
                      ),
                    },
                    {
                      key: 'count',
                      header: t('countLabel'),
                      accessor: (row) => row.count,
                    },
                  ]}
                  data={ratingChartData}
                  keyExtractor={(row, i) => `${row.date}-${i}`}
                />
              </CardContent>
            </Card>
          )}

          {/* Surveys table */}
          <Card className="border-border/70">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">{t('lessonColumn')} - {t('studentLessonRatings')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={[
                  {
                    key: 'studentName',
                    header: t('student'),
                    accessor: (row) => row.studentName || `ID: ${row.studentId}`,
                  },
                  {
                    key: 'lesson',
                    header: t('lessonColumn'),
                    accessor: (row) => row.lessonTopic || `ID: ${row.lessonId}`,
                  },
                  {
                    key: 'group',
                    header: t('group'),
                    accessor: (row) => row.groupName || t('noGroup'),
                  },
                  {
                    key: 'score',
                    header: t('score'),
                    accessor: (row) => row.score,
                    render: (row) => (
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              'h-3.5 w-3.5',
                              i < row.score
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-slate-200'
                            )}
                          />
                        ))}
                        <span className="ml-1 font-medium text-foreground">{row.score}</span>
                      </div>
                    ),
                  },
                  {
                    key: 'liked',
                    header: t('whatLiked'),
                    accessor: (row) => row.liked || '—',
                    cellClassName: 'max-w-[200px] truncate',
                  },
                  {
                    key: 'improve',
                    header: t('whatImprove'),
                    accessor: (row) => row.improve || '—',
                    cellClassName: 'max-w-[200px] truncate',
                  },
                  {
                    key: 'createdAt',
                    header: t('dateColumn'),
                    accessor: (row) =>
                      new Date(row.createdAt).toLocaleDateString('ru-RU'),
                  },
                ]}
                data={[...surveys].sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )}
                keyExtractor={(row) => String(row.id)}
                emptyState={
                  <EmptyState
                    title={t('noGrades')}
                    text={t('lessonRatingsWillAppear')}
                    icon={Star}
                  />
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
      ) : null}
      </ModulePageBody>
    </ModulePage>
  );
}
