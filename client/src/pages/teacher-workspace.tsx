import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import { PageHeader } from '@/components/ux/PageHeader';
import { AttendanceCalendar } from '@/components/ux/AttendanceCalendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Calendar,
  Users,
  ClipboardCheck,
  Star,
  GraduationCap,
  ClipboardList,
  CheckCircle2,
  XCircle,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sortAttendanceLessons } from '@/lib/attendance';
import { buildTeacherScheduleDays } from '@/lib/teacherSchedule';

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

function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'blue',
}: {
  title: string;
  value: string | number;
  detail?: string;
  icon: any;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-600',
  }[tone];

  return (
    <Card className="border-border/70 hover-lift group">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-500 truncate">{title}</p>
            <div className="mt-1.5 text-[26px] font-bold text-slate-900 leading-tight tracking-tight tabular-nums">
              {value}
            </div>
            {detail && <p className="mt-1 text-xs text-slate-400 truncate">{detail}</p>}
          </div>
          <div
            className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 ${toneClass}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
        <div className="mx-auto h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center">
          <Icon className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">{text}</p>
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

export default function TeacherWorkspace({ section = 'overview' }: { section?: TeacherSection }) {
  const { t } = useTranslation();
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
  const [isAttendanceDialogOpen, setAttendanceDialogOpen] = useState(false);
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
  const { data, isLoading, isError, error, refetch } = useQuery<any>({
    queryKey: ['/api/academy/workspaces/teacher'],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/teacher'] });

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

  const totalStudents = useMemo(
    () => groups.reduce((sum, g) => sum + (g.currentStudents || 0), 0),
    [groups]
  );

  const todayLessons = useMemo(
    () => lessons.filter((l) => isToday(l.scheduledAt)),
    [lessons]
  );

  const avgAttendance = useMemo(() => {
    if (!attendanceRecords.length) return 0;
    const presentCount = attendanceRecords.filter((a: any) => a.status === 'present').length;
    return Math.round((presentCount / attendanceRecords.length) * 100);
  }, [attendanceRecords]);

  const avgLessonRating = useMemo(() => {
    if (!surveys.length) return 0;
    const sum = surveys.reduce((acc, s) => acc + s.score, 0);
    return (sum / surveys.length).toFixed(1);
  }, [surveys]);

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
    return students.filter((s) => s.groupId === selectedGroup.id);
  }, [students, selectedGroup]);

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

  if (isError) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-8 text-center">
        <p className="font-medium text-destructive">{t('error')}</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : t('failedToLoadData')}</p>
        <Button variant="outline" onClick={() => refetch()}>{t('retry')}</Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const fullName = user?.fullName || t('teacher');
  const sectionTitle: Record<TeacherSection, string> = {
    overview: `${t('hello')}, ${fullName}`,
    schedule: t('schedule'),
    groups: t('myGroups'),
    attendance: t('attendanceLabel'),
    ratings: t('lessonRatings'),
  };

  const getLessonStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
      conducted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      cancelled: 'bg-red-100 text-red-700 border-red-200',
      postponed: 'bg-amber-100 text-amber-700 border-amber-200',
    };
    return (
      <Badge className={cn('text-xs font-medium', variants[status] || 'bg-slate-100 text-slate-700')}>
        {status === 'scheduled' && t('lessonStatusScheduled')}
        {status === 'conducted' && t('lessonStatusConducted')}
        {status === 'cancelled' && t('lessonStatusCancelled')}
        {status === 'postponed' && t('lessonStatusPostponed')}
        {!['scheduled', 'conducted', 'cancelled', 'postponed'].includes(status) && status}
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

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title={sectionTitle[section]}
        subtitle={t('teacherWorkspace')}
        breadcrumbs={[
          { label: t('navDashboard'), href: '/teacher-workspace' },
          ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
        ]}
      />

      {/* KPI Cards */}
      {section === 'overview' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="stagger-item">
            <KpiCard
              title={t('myGroupsCount')}
              value={groups.length}
              detail={teacherCourses.map((c: any) => c.name).join(', ') || t('noData')}
              icon={Users}
              tone="blue"
            />
          </div>
          <div className="stagger-item">
            <KpiCard
              title={t('totalStudents')}
              value={totalStudents}
              detail={`${t('maxStudents')}: ${groups.reduce((s, g) => s + (g.maxStudents || 12), 0)}`}
              icon={GraduationCap}
              tone="green"
            />
          </div>
          <div className="stagger-item">
            <KpiCard
              title={t('lessonsToday')}
              value={todayLessons.length}
              detail={formatDateFull(new Date().toISOString())}
              icon={Calendar}
              tone="amber"
            />
          </div>
          <div className="stagger-item">
            <KpiCard
              title={t('averageAttendance')}
              value={`${avgAttendance}%`}
              detail={t('byActiveStudents')}
              icon={ClipboardCheck}
              tone="blue"
            />
          </div>
        </div>
      ) : null}

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
                        <Badge className="bg-primary-100 text-primary-700 text-[10px]">
                          {t('now')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {day.date.toLocaleDateString('ru-RU', {
                        timeZone: 'UTC',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {day.lessons.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-4">{t('noLessonsToday')}</p>
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
                          <span className="font-semibold text-slate-900">{formatTime(lesson.scheduledAt)}</span>
                          {getLessonStatusBadge(lesson.status)}
                        </div>
                        <p className="text-slate-700 font-medium truncate">{lesson.groupName || t('noGroup')}</p>
                        <p className="text-slate-500 truncate">{lesson.topic}</p>
                        {lesson.status === 'conducted' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2 mt-1 text-primary-600 hover:text-primary-700"
                            onClick={() => {
                              setSelectedLessonId(String(lesson.id));
                              setLocation('/teacher-workspace/attendance');
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
                        <div className="text-sm font-semibold text-slate-900 tabular-nums">
                          {formatTime(lesson.scheduledAt)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {lesson.groupName || t('noGroup')} • {lesson.topic}
                          </p>
                          <p className="text-xs text-slate-500">
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
                              setLocation('/teacher-workspace/attendance');
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
                      <p className="text-sm text-slate-500 mt-1">
                        {selectedGroup.courseName || t('noCourse')} • {t('teacher')}: {user?.fullName}
                      </p>
                    </div>
                    <Badge
                      className={
                        selectedGroup.status === 'open'
                          ? 'bg-emerald-100 text-emerald-700'
                          : selectedGroup.status === 'full'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                      }
                    >
                      {selectedGroup.status === 'open' && t('groupStatusOpen')}
                      {selectedGroup.status === 'full' && t('groupStatusFull')}
                      {selectedGroup.status === 'closed' && t('groupStatusClosed')}
                      {selectedGroup.status === 'archived' && t('groupStatusArchived')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-600">{t('groupOccupancy')}</span>
                      <span className="font-medium text-slate-900">
                        {selectedGroup.currentStudents || 0} / {selectedGroup.maxStudents}
                      </span>
                    </div>
                    <Progress
                      value={
                        ((selectedGroup.currentStudents || 0) /
                          (selectedGroup.maxStudents || 1)) *
                        100
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
                          key: 'attendance',
                          header: t('attendanceLabel'),
                          accessor: (row) => `${row.attendancePercent || 0}%`,
                        },
                        {
                          key: 'progress',
                          header: t('progressLabel'),
                          accessor: (row) => `${row.progressPercent || 0}%`,
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
                  className="border-border/70 hover-lift cursor-pointer group"
                  onClick={() => setSelectedGroup(group)}
                >
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">
                          {group.name}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {group.courseName || t('noCourse')} · {group.schoolName || t('schoolNotSelected')}
                        </p>
                      </div>
                      <Badge
                        className={
                          group.status === 'open'
                            ? 'bg-emerald-100 text-emerald-700'
                            : group.status === 'full'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                        }
                      >
                        {group.status === 'open' && t('enrollmentShort')}
                        {group.status === 'full' && t('groupStatusFull')}
                        {group.status === 'closed' && t('groupStatusClosed')}
                        {group.status === 'archived' && t('groupStatusArchived')}
                      </Badge>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-slate-500">{t('occupancyColumn')}</span>
                        <span className="text-slate-700 font-medium">
                          {group.currentStudents || 0} / {group.maxStudents}
                        </span>
                      </div>
                      <Progress
                        value={
                          ((group.currentStudents || 0) / (group.maxStudents || 1)) * 100
                        }
                        className="h-2"
                      />
                    </div>

                    {group.schedule && group.schedule.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {group.schedule.map((s, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            {dayNames[s.dayOfWeek - 1] || ''} {formatScheduleTime(s)}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
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
          <AttendanceCalendar
            lessons={attendanceLessons}
            selectedLessonId={selectedLessonId}
            now={now}
            disabled={lessonMutationPending}
            onSelectLesson={(lessonId) => {
              if (lessonMutationPending) return;
              attendanceDraftDirty.current = false;
              attendanceNoteDirty.current = false;
              setSelectedLessonId(lessonId);
              setAttendanceDraft({});
              setAttendanceNote('');
              setAttendanceDialogOpen(true);
            }}
          />

          <Dialog open={isAttendanceDialogOpen} onOpenChange={setAttendanceDialogOpen}>
            <DialogContent className="max-h-[90vh] max-w-4xl gap-0 overflow-y-auto p-0">
              <DialogHeader className="border-b border-border/70 px-6 py-5 pr-12">
                <DialogTitle>{t('attendanceChecklist')}</DialogTitle>
                <DialogDescription>{t('attendanceCalendarHint')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 p-6">
              {selectedLessonDetails && (
                <div className="rounded-lg border border-border/70 bg-muted/50 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-slate-900">
                      {selectedLessonDetails.groupName || t('noGroup')} — {selectedLessonDetails.topic}
                    </div>
                    {getLessonStatusBadge(selectedLessonDetails.status)}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {formatDateFull(selectedLessonDetails.scheduledAt)} •{' '}
                    {formatTime(selectedLessonDetails.scheduledAt)} •{' '}
                    {selectedLessonDetails.durationMinutes}
                    {t('minutes')}
                  </div>
                </div>
              )}

              {selectedLessonDetails && ['scheduled', 'conducted'].includes(selectedLessonDetails.status) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{t('rescheduleLesson')}</div>
                    <p className="mt-0.5 text-xs text-slate-600">{t('rescheduleLessonHint')}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="reschedule-at" className="text-xs text-slate-600">
                        {t('newLessonDate')}
                      </Label>
                      <Input
                        id="reschedule-at"
                        type="datetime-local"
                        min={toDateTimeLocal(new Date(now + 5 * 60 * 1000))}
                        value={rescheduleAt}
                        disabled={lessonMutationPending}
                        onChange={(event) => setRescheduleAt(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reschedule-reason" className="text-xs text-slate-600">
                        {t('rescheduleReason')}
                      </Label>
                      <Input
                        id="reschedule-reason"
                        value={rescheduleReason}
                        maxLength={500}
                        disabled={lessonMutationPending}
                        onChange={(event) => setRescheduleReason(event.target.value)}
                        placeholder={t('rescheduleReasonPlaceholder')}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleRescheduleLesson}
                      disabled={!canRescheduleLesson || lessonMutationPending}
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      {rescheduleLesson.isPending ? t('saving') : t('rescheduleLesson')}
                    </Button>
                  </div>
                </div>
              )}

              {selectedLesson && attendanceRosterQuery.isPending && (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-56" />
                  <Skeleton className="h-48 w-full" />
                </div>
              )}

              {selectedLesson && attendanceRosterQuery.isError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                  <p className="text-sm font-medium text-destructive">{t('attendanceRosterLoadFailed')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {attendanceRosterQuery.error instanceof Error
                      ? attendanceRosterQuery.error.message
                      : t('failedToLoadData')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={lessonMutationPending}
                    onClick={() => attendanceRosterQuery.refetch()}
                  >
                    {t('retry')}
                  </Button>
                </div>
              )}

              {selectedLesson
                && !attendanceRosterQuery.isPending
                && !attendanceRosterQuery.isError
                && selectedLessonStudents.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={lessonMutationPending}
                      onClick={() => handleSetAllAttendance('present')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      {t('allPresent')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={lessonMutationPending}
                      onClick={() => handleSetAllAttendance('absent')}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      {t('allAbsent')}
                    </Button>
                  </div>

                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-muted/70">
                        <tr className="border-b border-border/70">
                          <th className="text-left p-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {t('studentName')}
                          </th>
                          <th className="text-center p-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {t('present')}
                          </th>
                          <th className="text-center p-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {t('absent')}
                          </th>
                          <th className="text-right p-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {t('attendanceLabel')} %
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLessonStudents.map((student) => {
                          const status = attendanceDraft[student.id];
                          return (
                            <tr
                              key={student.id}
                              className="border-b border-slate-100 hover:bg-primary/[0.035] transition-colors"
                            >
                              <td className="p-3 px-4 font-medium text-slate-900">
                                {student.studentName || student.contactName}
                              </td>
                              <td className="p-3 px-4 text-center">
                                <Checkbox
                                  checked={status === 'present'}
                                  disabled={lessonMutationPending}
                                  onCheckedChange={() =>
                                    handleToggleAttendance(student.id, 'present')
                                  }
                                  className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                />
                              </td>
                              <td className="p-3 px-4 text-center">
                                <Checkbox
                                  checked={status === 'absent'}
                                  disabled={lessonMutationPending}
                                  onCheckedChange={() =>
                                    handleToggleAttendance(student.id, 'absent')
                                  }
                                  className="data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                                />
                              </td>
                              <td className="p-3 px-4 text-right tabular-nums text-slate-500">
                                {student.attendancePercent || 0}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">{t('comment')}</Label>
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
                    />
                  </div>

                  <div className="flex justify-end">
                    <div className="space-y-1 text-right">
                      {selectedLessonDetails?.status === 'scheduled' && !selectedLessonHasStarted && (
                        <p className="text-xs text-amber-700">{t('attendanceAvailableAfterLessonStart')}</p>
                      )}
                      {previousIncompleteLesson && (
                        <p className="text-xs text-amber-700">{t('previousLessonMustBeCompleted')}</p>
                      )}
                      <Button
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
                  </div>
                </>
              )}

              {selectedLesson
                && !attendanceRosterQuery.isPending
                && !attendanceRosterQuery.isError
                && selectedLessonStudents.length === 0 && (
                <div className="space-y-3">
                  <EmptyState
                    title={t('noStudents')}
                    text={t('noStudentsInGroup')}
                    icon={Users}
                  />
                  {selectedLessonDetails?.status === 'scheduled' && (
                    <div className="flex justify-end">
                      <div className="space-y-1 text-right">
                        {previousIncompleteLesson && (
                          <p className="text-xs text-amber-700">{t('previousLessonMustBeCompleted')}</p>
                        )}
                        <Button
                          onClick={handleSaveAttendance}
                          disabled={!canSaveAttendance || lessonMutationPending}
                        >
                          {saveAttendance.isPending ? t('saving') : t('finishLessonAndSaveAttendance')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!selectedLesson && (
                <EmptyState
                  title={t('selectLessonPlaceholder')}
                  text={t('selectLessonForAttendance')}
                  icon={ClipboardList}
                />
              )}
              </div>
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
                        <p className="text-sm text-slate-500 truncate">
                          {group?.name || t('noGroup')}
                        </p>
                        <div className="mt-1.5 text-[26px] font-bold text-slate-900 leading-tight tabular-nums">
                          {avgScore}
                          <span className="text-sm text-slate-400 ml-1">/ 5</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
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
                  <TrendingUp className="h-4 w-4 text-slate-500" />
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
                          <span className="font-medium text-slate-900">{row.avgScore}</span>
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
                        <span className="ml-1 font-medium text-slate-900">{row.score}</span>
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
    </div>
  );
}
