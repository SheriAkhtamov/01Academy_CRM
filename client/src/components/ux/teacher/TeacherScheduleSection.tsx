import { useCallback, useMemo, useState } from 'react';
import type { DemoLesson } from '@/features/demo-lessons/api';
import {
  BookOpen,
  Calendar as CalendarIcon,
  CalendarDays,
  ClipboardCheck,
  Clock,
  LayoutGrid,
  List,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CalendarNavigator } from '@/components/ux/calendar/CalendarNavigator';
import { EmptyState } from '@/components/ux/EmptyState';
import { LessonStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { TruncatedText } from '@/components/ux/teacher/TruncatedText';
import { useTranslation } from '@/hooks/useTranslation';
import {
  formatAcademyDate,
  resolveLocale,
} from '@/lib/localeFormat';
import {
  academyDayKey,
  dateFromDayKey,
  formatLessonEndTime,
  isLessonStarted,
  shiftDayKey,
  TEACHER_CARD_PADDING,
  TEACHER_CARD_PADDING_DENSE,
  weekStartDayKey,
  type TeacherGroup,
  type TeacherLesson,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';

export type TeacherScheduleDayView = {
  dateKey: string;
  date: Date;
  weekdayIndex: number;
  lessons: TeacherLesson[];
};

type ScheduleViewMode = 'week' | 'hours' | 'day' | 'month' | 'agenda';
type ScheduleStatusFilter = 'all' | 'scheduled' | 'conducted' | 'demos';

interface TeacherScheduleSectionProps {
  days: TeacherScheduleDayView[];
  nextLesson?: TeacherLesson | null;
  dayNames: string[];
  todayKey: string;
  atToday: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onOpenNextLesson: (lessonId: string) => void;
  onOpenAttendance: (lessonId: string) => void;
  allLessons?: TeacherLesson[];
  groups?: TeacherGroup[];
  demos?: DemoLesson[];
  onSelectDemo?: (demo: DemoLesson) => void;
  onOpenGroup?: (groupId: number) => void;
}

const HOUR_SLOTS = Array.from({ length: 13 }, (_, idx) => idx + 8); // 08:00 .. 20:00

function getAcademyHour(iso: string | Date): number {
  const formatted = formatAcademyDate(iso, 'ru', { hour: '2-digit', hour12: false });
  const parsed = Number.parseInt(formatted, 10);
  return Number.isFinite(parsed) ? parsed : 9;
}

export function TeacherScheduleSection({
  days,
  nextLesson,
  dayNames,
  todayKey,
  atToday,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onOpenNextLesson,
  onOpenAttendance,
  allLessons,
  groups = [],
  demos = [],
  onSelectDemo,
  onOpenGroup,
}: TeacherScheduleSectionProps) {
  const { t, language } = useTranslation();
  const locale = resolveLocale(language);

  const [viewMode, setViewMode] = useState<ScheduleViewMode>('week');
  const [selectedDayKey, setSelectedDayKey] = useState<string>(todayKey);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ScheduleStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const matchesLessonFilter = useCallback((lesson: TeacherLesson) => {
    if (statusFilter === 'demos') return false;
    if (statusFilter === 'scheduled' && lesson.status !== 'scheduled') return false;
    if (statusFilter === 'conducted' && lesson.status !== 'conducted') return false;
    if (groupFilter !== 'all' && String(lesson.groupId ?? '') !== groupFilter) return false;
    if (normalizedQuery) {
      const haystack = `${lesson.groupName ?? ''} ${lesson.courseName ?? ''} ${lesson.topic ?? ''}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  }, [statusFilter, groupFilter, normalizedQuery]);

  const matchesDemoFilter = useCallback((demo: DemoLesson) => {
    if (statusFilter === 'scheduled' || statusFilter === 'conducted') return false;
    if (groupFilter !== 'all') return false;
    if (normalizedQuery) {
      const haystack = `${demo.courseName ?? ''} ${demo.schoolName ?? ''} ${demo.roomName ?? ''}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  }, [statusFilter, groupFilter, normalizedQuery]);

  const demosByDateKey = useMemo(() => {
    const map = new Map<string, DemoLesson[]>();
    for (const demo of demos) {
      if (!matchesDemoFilter(demo)) continue;
      const key = academyDayKey(demo.scheduledAt);
      const list = map.get(key);
      if (list) {
        list.push(demo);
      } else {
        map.set(key, [demo]);
      }
    }
    return map;
  }, [demos, matchesDemoFilter]);

  const filteredDays = useMemo(
    () =>
      days.map((day) => ({
        ...day,
        lessons: day.lessons.filter(matchesLessonFilter),
        demos: demosByDateKey.get(day.dateKey) ?? [],
      })),
    [days, demosByDateKey, matchesLessonFilter],
  );

  const rawWeekLessons = useMemo(
    () => days.reduce((total, day) => total + day.lessons.length, 0),
    [days],
  );

  const weekLessons = useMemo(
    () => filteredDays.reduce((total, day) => total + day.lessons.length, 0),
    [filteredDays],
  );
  const weekDemosCount = useMemo(
    () => filteredDays.reduce((total, day) => total + day.demos.length, 0),
    [filteredDays],
  );
  const weekConducted = useMemo(
    () =>
      filteredDays.reduce(
        (total, day) => total + day.lessons.filter((lesson) => lesson.status === 'conducted').length,
        0,
      ),
    [filteredDays],
  );
  const weekPendingCount = useMemo(
    () =>
      filteredDays.reduce(
        (total, day) =>
          total +
          day.lessons.filter(
            (lesson) => lesson.status === 'scheduled' && isLessonStarted(lesson.scheduledAt),
          ).length,
        0,
      ),
    [filteredDays],
  );
  const weekHours = useMemo(() => {
    const minutes = filteredDays.reduce(
      (total, day) =>
        total + day.lessons.reduce((sum, l) => sum + (Number(l.durationMinutes) || 90), 0),
      0,
    );
    return Math.round((minutes / 60) * 10) / 10;
  }, [filteredDays]);

  const emptyDayCount = useMemo(
    () =>
      filteredDays.filter(
        (day) => day.lessons.length === 0 && day.demos.length === 0 && day.dateKey !== todayKey,
      ).length,
    [filteredDays, todayKey],
  );

  const formatters = useMemo(
    () => ({
      dayMonth: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      dayMonthYear: new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      monthYear: new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    }),
    [locale],
  );

  const rangeLabel =
    days.length > 0
      ? `${formatters.dayMonth.format(days[0].date)} — ${formatters.dayMonthYear.format(days[days.length - 1].date)}`
      : '';

  const activeDayView = useMemo(() => {
    const found = filteredDays.find((d) => d.dateKey === selectedDayKey);
    if (found) return found;
    return filteredDays.find((d) => d.dateKey === todayKey) ?? filteredDays[0] ?? null;
  }, [filteredDays, selectedDayKey, todayKey]);

  const monthDays = useMemo(() => {
    const anchorDate = days[0]?.date ?? dateFromDayKey(todayKey);
    const firstOfMonthKey = `${anchorDate.getUTCFullYear()}-${String(anchorDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const gridStartKey = weekStartDayKey(firstOfMonthKey);
    const lessonsSource = allLessons ?? days.flatMap((d) => d.lessons);
    const lessonsMap = new Map<string, TeacherLesson[]>();
    for (const lesson of lessonsSource) {
      if (!matchesLessonFilter(lesson)) continue;
      const key = academyDayKey(lesson.scheduledAt);
      const bucket = lessonsMap.get(key);
      if (bucket) bucket.push(lesson);
      else lessonsMap.set(key, [lesson]);
    }
    return Array.from({ length: 35 }, (_, idx) => {
      const dateKey = shiftDayKey(gridStartKey, idx);
      const date = dateFromDayKey(dateKey);
      return {
        date,
        dateKey,
        inMonth: date.getUTCMonth() === anchorDate.getUTCMonth(),
        lessons: (lessonsMap.get(dateKey) ?? []).sort(
          (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
        ),
        demos: demosByDateKey.get(dateKey) ?? [],
      };
    });
  }, [days, todayKey, allLessons, demosByDateKey, matchesLessonFilter]);

  const hasActiveFilters =
    groupFilter !== 'all' || statusFilter !== 'all' || normalizedQuery.length > 0;

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className={cn('space-y-3', TEACHER_CARD_PADDING_DENSE)}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CalendarNavigator
              label={rangeLabel}
              hint={
                <span className="flex flex-wrap items-center gap-2 tabular-nums">
                  <span>
                    {t('scheduleWeekLessonsSummary')
                      .replace('{total}', String(weekLessons))
                      .replace('{conducted}', String(weekConducted))}
                  </span>
                  {weekHours > 0 ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-medium">
                      <Clock className="mr-1 size-3" />
                      {t('teacherScheduleHoursCount', { hours: weekHours })}
                    </Badge>
                  ) : null}
                  {weekPendingCount > 0 ? (
                    <Badge variant="outline" className="h-5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {t('teacherSchedulePendingCount', { count: weekPendingCount })}
                    </Badge>
                  ) : null}
                  {weekDemosCount > 0 ? (
                    <Badge variant="outline" className="h-5 border-violet-500/40 bg-violet-500/10 px-1.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                      <Sparkles className="mr-1 size-3" />
                      {t('teacherScheduleDemosCount', { count: weekDemosCount })}
                    </Badge>
                  ) : null}
                </span>
              }
              previousLabel={t('previousWeek')}
              nextLabel={t('nextWeek')}
              atToday={atToday}
              onPrevious={onPreviousWeek}
              onNext={onNextWeek}
              onToday={onToday}
            />

            <div
              role="group"
              aria-label={t('calendarViewMode')}
              className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-muted/40 p-1"
            >
              {(
                [
                  { id: 'week', label: t('calendarViewWeek'), icon: LayoutGrid },
                  { id: 'hours', label: t('teacherScheduleWeekGrid'), icon: Clock },
                  { id: 'day', label: t('calendarViewDay'), icon: CalendarIcon },
                  { id: 'month', label: t('calendarViewMonth'), icon: CalendarDays },
                  { id: 'agenda', label: t('calendarViewAgenda'), icon: List },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={viewMode === id ? 'default' : 'ghost'}
                  className="h-8 rounded-lg px-2.5 text-xs font-medium"
                  onClick={() => setViewMode(id)}
                >
                  <Icon className="mr-1.5 size-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {(rawWeekLessons > 0 || demos.length > 0 || groups.length > 0 || hasActiveFilters) ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <div className="relative min-w-48 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('teacherScheduleSearchPlaceholder')}
                  aria-label={t('search')}
                  className="h-9 pl-9 pr-8 text-xs"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    aria-label={t('clearSearch')}
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>

              {groups.length > 0 ? (
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="h-9 w-auto min-w-40 text-xs" aria-label={t('group')}>
                    <SelectValue placeholder={t('teacherScheduleAllGroups')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('teacherScheduleAllGroups')}</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={String(group.id)}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-background p-0.5">
                {(
                  [
                    { id: 'all', label: t('teacherScheduleAllTypes') },
                    { id: 'scheduled', label: t('lessonStatusScheduled') },
                    { id: 'conducted', label: t('lessonStatusConducted') },
                    ...(demos.length > 0 ? [{ id: 'demos' as const, label: t('teacherScheduleDemosOnly') }] : []),
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStatusFilter(item.id)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      statusFilter === item.id
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => {
                    setGroupFilter('all');
                    setStatusFilter('all');
                    setSearchQuery('');
                  }}
                >
                  {t('resetFilters')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {weekLessons === 0 && weekDemosCount === 0 && viewMode !== 'month' ? (
        <Card className="border-dashed border-border/70">
          <CardContent className="p-0">
            <EmptyState
              icon={CalendarDays}
              title={hasActiveFilters ? t('lessonsHiddenByFilters') : t('noLessonsInRange')}
              action={
                hasActiveFilters ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      setGroupFilter('all');
                      setStatusFilter('all');
                      setSearchQuery('');
                    }}
                  >
                    {t('resetFilters')}
                  </Button>
                ) : nextLesson ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => onOpenNextLesson(String(nextLesson.id))}
                  >
                    {t('showNextLesson')}
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : viewMode === 'week' ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
            {filteredDays.map((day) => {
              const isTodayColumn = day.dateKey === todayKey;
              const isEmptyDay = day.lessons.length === 0 && day.demos.length === 0;
              return (
                <Card
                  key={day.dateKey}
                  className={cn(
                    'flex min-w-0 flex-col border-border/70',
                    isTodayColumn && 'border-primary/40 ring-1 ring-primary/25',
                    isEmptyDay && !isTodayColumn && 'max-sm:hidden',
                  )}
                >
                  <CardHeader
                    className={cn(
                      'gap-0 rounded-t-xl px-3 pb-2 pt-3',
                      isTodayColumn ? 'bg-primary/5' : 'bg-muted/20',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          'text-sm font-semibold capitalize',
                          isTodayColumn ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {dayNames[day.weekdayIndex]}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {!isEmptyDay ? (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
                            {day.lessons.length + day.demos.length}
                          </Badge>
                        ) : null}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatters.dayMonth.format(day.date)}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2 px-3 pb-3 pt-2">
                    {isEmptyDay ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        {t('noLessonsThisDay')}
                      </p>
                    ) : null}
                    {day.lessons.map((lesson) => {
                      const endTime = formatLessonEndTime(
                        lesson.scheduledAt,
                        lesson.durationMinutes,
                        language,
                      );
                      return (
                        <div
                          key={lesson.id}
                          className={cn(
                            'space-y-1.5 rounded-xl border p-2.5 text-xs transition-all hover:shadow-xs',
                            lesson.status === 'conducted'
                              ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
                              : isTodayColumn
                                ? 'border-primary/30 bg-primary/5'
                                : 'border-border/60 bg-muted/35',
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                            <span className="font-semibold tabular-nums text-foreground">
                              {formatAcademyDate(lesson.scheduledAt, language, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                              {endTime ? ` – ${endTime}` : ''}
                            </span>
                            <LessonStatusBadge status={lesson.status} />
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <TruncatedText
                              text={lesson.groupName || t('noGroup')}
                              className="block font-semibold text-foreground"
                            />
                            {lesson.lessonNumber != null ? (
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                #{lesson.lessonNumber}
                              </span>
                            ) : null}
                          </div>
                          {lesson.courseName ? (
                            <p className="truncate text-[11px] font-medium text-primary/80">
                              {lesson.courseName}
                            </p>
                          ) : null}
                          <TruncatedText
                            text={lesson.topic}
                            className="block text-muted-foreground"
                          />
                          <p className="text-[11px] tabular-nums text-muted-foreground">
                            {t('durationMinutesValue').replace(
                              '{count}',
                              String(lesson.durationMinutes),
                            )}
                          </p>
                          <div className="flex items-center gap-1.5 pt-0.5">
                            {lesson.status === 'scheduled' || lesson.status === 'conducted' ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-h-9 flex-1 rounded-lg bg-background text-xs font-medium"
                                onClick={() => onOpenAttendance(String(lesson.id))}
                              >
                                <ClipboardCheck className="mr-1.5 size-3.5" />
                                {t('attendanceLabel')}
                              </Button>
                            ) : null}
                            {onOpenGroup && lesson.groupId ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={t('teacherOpenGroup')}
                                className="min-h-9 px-2"
                                onClick={() => onOpenGroup(lesson.groupId!)}
                              >
                                <Users className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {day.demos.map((demo) => (
                      <button
                        key={`demo-${demo.id}`}
                        type="button"
                        onClick={() => onSelectDemo?.(demo)}
                        className="w-full space-y-1.5 rounded-xl border border-violet-500/35 bg-violet-500/[0.06] p-2.5 text-left text-xs transition-all hover:border-violet-500/60 hover:shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatAcademyDate(demo.scheduledAt, language, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-violet-500/40 bg-violet-500/10 text-[10px] text-violet-700 dark:text-violet-300"
                          >
                            {t('demoLesson')}
                          </Badge>
                        </div>
                        <p className="truncate font-semibold text-foreground">
                          {demo.courseName || t('demoLesson')}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {demo.participants.length} {t('demoParticipantsShort')}
                        </p>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {emptyDayCount > 0 ? (
            <p
              className={cn(
                'rounded-xl border border-dashed border-border/70 text-center text-xs text-muted-foreground sm:hidden',
                TEACHER_CARD_PADDING,
              )}
            >
              {t('scheduleEmptyDaysCollapsed').replace('{count}', String(emptyDayCount))}
            </p>
          ) : null}
        </>
      ) : viewMode === 'hours' ? (
        <Card className="overflow-hidden border-border/70">
          <div className="overflow-x-auto">
            <div className="min-w-[780px]">
              <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/30">
                <div className="border-r border-border p-2" />
                {filteredDays.map((day) => {
                  const isTodayColumn = day.dateKey === todayKey;
                  return (
                    <div
                      key={day.dateKey}
                      className={cn(
                        'border-r border-border px-2 py-2.5 text-center last:border-r-0',
                        isTodayColumn && 'bg-primary/5',
                      )}
                    >
                      <p
                        className={cn(
                          'text-xs font-semibold capitalize',
                          isTodayColumn ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {dayNames[day.weekdayIndex]}
                      </p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        {formatters.dayMonth.format(day.date)}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="divide-y divide-border/60">
                {HOUR_SLOTS.map((hour) => (
                  <div
                    key={hour}
                    className="grid min-h-16 grid-cols-[64px_repeat(7,minmax(0,1fr))]"
                  >
                    <div className="border-r border-border px-2 py-2 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                      {String(hour).padStart(2, '0')}:00
                    </div>
                    {filteredDays.map((day) => {
                      const slotLessons = day.lessons.filter(
                        (l) => getAcademyHour(l.scheduledAt) === hour,
                      );
                      const slotDemos = day.demos.filter(
                        (d) => getAcademyHour(d.scheduledAt) === hour,
                      );
                      return (
                        <div
                          key={`${day.dateKey}-${hour}`}
                          className={cn(
                            'space-y-1 border-r border-border/60 p-1 last:border-r-0',
                            day.dateKey === todayKey && 'bg-primary/[0.02]',
                          )}
                        >
                          {slotLessons.map((lesson) => (
                            <button
                              key={lesson.id}
                              type="button"
                              onClick={() => onOpenAttendance(String(lesson.id))}
                              className={cn(
                                'w-full rounded-lg border p-1.5 text-left text-[11px] transition-colors hover:border-primary/50',
                                lesson.status === 'conducted'
                                  ? 'border-emerald-500/30 bg-emerald-500/10'
                                  : 'border-primary/25 bg-primary/10',
                              )}
                            >
                              <div className="flex items-center justify-between gap-1 font-semibold tabular-nums">
                                <span>
                                  {formatAcademyDate(lesson.scheduledAt, language, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                <LessonStatusBadge status={lesson.status} />
                              </div>
                              <p className="truncate font-semibold text-foreground">
                                {lesson.groupName || t('noGroup')}
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground">
                                {lesson.topic}
                              </p>
                            </button>
                          ))}
                          {slotDemos.map((demo) => (
                            <button
                              key={`demo-${demo.id}`}
                              type="button"
                              onClick={() => onSelectDemo?.(demo)}
                              className="w-full rounded-lg border border-violet-500/40 bg-violet-500/10 p-1.5 text-left text-[11px]"
                            >
                              <p className="truncate font-semibold text-foreground">
                                {demo.courseName || t('demoLesson')}
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground">
                                {t('demoLesson')}
                              </p>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : viewMode === 'day' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-7 gap-1.5">
            {filteredDays.map((day) => {
              const isSelected = activeDayView?.dateKey === day.dateKey;
              const isToday = day.dateKey === todayKey;
              const count = day.lessons.length + day.demos.length;
              return (
                <button
                  key={day.dateKey}
                  type="button"
                  onClick={() => setSelectedDayKey(day.dateKey)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-all',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary shadow-2xs'
                      : isToday
                        ? 'border-primary/40 bg-background text-foreground'
                        : 'border-border/70 bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="text-[11px] font-semibold capitalize">
                    {dayNames[day.weekdayIndex]}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {formatters.dayMonth.format(day.date)}
                  </span>
                  <Badge variant={count > 0 ? 'secondary' : 'outline'} className="h-4 px-1.5 text-[10px]">
                    {count}
                  </Badge>
                </button>
              );
            })}
          </div>

          {activeDayView ? (
            <Card className="border-border/70">
              <CardContent className={cn('space-y-3', TEACHER_CARD_PADDING)}>
                {activeDayView.lessons.length === 0 && activeDayView.demos.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t('noLessonsThisDay')}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {activeDayView.lessons.map((lesson) => {
                      const endTime = formatLessonEndTime(
                        lesson.scheduledAt,
                        lesson.durationMinutes,
                        language,
                      );
                      return (
                        <div
                          key={lesson.id}
                          className="flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5 sm:flex-row sm:items-center"
                        >
                          <div className="flex items-start gap-3">
                            <div className="min-w-24 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-center">
                              <p className="text-sm font-bold tabular-nums text-foreground">
                                {formatAcademyDate(lesson.scheduledAt, language, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                              {endTime ? (
                                <p className="text-[11px] tabular-nums text-muted-foreground">
                                  {endTime}
                                </p>
                              ) : null}
                            </div>
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-foreground">
                                  {lesson.groupName || t('noGroup')}
                                </span>
                                <LessonStatusBadge status={lesson.status} />
                                {lesson.courseName ? (
                                  <Badge variant="secondary" className="text-[11px]">
                                    <BookOpen className="mr-1 size-3" />
                                    {lesson.courseName}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-sm text-muted-foreground">{lesson.topic}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-center">
                            {onOpenGroup && lesson.groupId ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onOpenGroup(lesson.groupId!)}
                              >
                                <Users className="mr-1.5 size-4" />
                                {t('teacherOpenGroup')}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onOpenAttendance(String(lesson.id))}
                            >
                              <ClipboardCheck className="mr-1.5 size-4" />
                              {t('attendanceLabel')}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {activeDayView.demos.map((demo) => (
                      <div
                        key={`demo-${demo.id}`}
                        className="flex flex-col justify-between gap-3 rounded-xl border border-violet-500/35 bg-violet-500/[0.06] p-3.5 sm:flex-row sm:items-center"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold tabular-nums">
                              {formatAcademyDate(demo.scheduledAt, language, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <Badge variant="outline" className="border-violet-500/40 text-xs">
                              {t('demoLesson')}
                            </Badge>
                          </div>
                          <p className="font-semibold text-foreground">
                            {demo.courseName || t('demoLesson')}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onSelectDemo?.(demo)}
                        >
                          {t('details')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : viewMode === 'month' ? (
        <Card className="overflow-hidden border-border/70">
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-7 border-b border-border bg-muted/30">
                {dayNames.map((name, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-2 text-center text-xs font-semibold capitalize text-muted-foreground"
                  >
                    {name}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((cell) => {
                  const isToday = cell.dateKey === todayKey;
                  const itemsCount = cell.lessons.length + cell.demos.length;
                  return (
                    <div
                      key={cell.dateKey}
                      className={cn(
                        'min-h-28 space-y-1 border-b border-r border-border/60 p-2 [&:nth-child(7n)]:border-r-0',
                        !cell.inMonth && 'bg-muted/25 opacity-60',
                        isToday && 'bg-primary/[0.04]',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDayKey(cell.dateKey);
                            setViewMode('day');
                          }}
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                            isToday
                              ? 'bg-primary text-primary-foreground'
                              : 'text-foreground hover:bg-muted',
                          )}
                        >
                          {cell.date.getUTCDate()}
                        </button>
                        {itemsCount > 0 ? (
                          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                            {itemsCount}
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {cell.lessons.slice(0, 3).map((lesson) => (
                          <button
                            key={lesson.id}
                            type="button"
                            onClick={() => onOpenAttendance(String(lesson.id))}
                            className={cn(
                              'flex w-full items-center gap-1 rounded border-l-2 px-1.5 py-0.5 text-left text-[10px] font-medium transition-colors hover:brightness-95',
                              lesson.status === 'conducted'
                                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                                : 'border-primary bg-primary/10 text-foreground',
                            )}
                          >
                            <span className="shrink-0 tabular-nums opacity-80">
                              {formatAcademyDate(lesson.scheduledAt, language, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="truncate">{lesson.groupName || lesson.topic}</span>
                          </button>
                        ))}
                        {cell.demos.slice(0, 2).map((demo) => (
                          <button
                            key={`demo-${demo.id}`}
                            type="button"
                            onClick={() => onSelectDemo?.(demo)}
                            className="flex w-full items-center gap-1 rounded border-l-2 border-violet-500 bg-violet-500/10 px-1.5 py-0.5 text-left text-[10px] font-medium text-violet-900 dark:text-violet-200"
                          >
                            <span className="truncate">
                              {demo.courseName || t('demoLesson')}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden border-border/70">
          <div className="divide-y divide-border/60">
            {filteredDays
              .filter((day) => day.lessons.length > 0 || day.demos.length > 0)
              .map((day) => {
                const isToday = day.dateKey === todayKey;
                return (
                  <div key={day.dateKey}>
                    <div
                      className={cn(
                        'flex items-center justify-between bg-muted/40 px-4 py-2 text-xs font-semibold capitalize',
                        isToday ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      <span>
                        {dayNames[day.weekdayIndex]} · {formatters.dayMonthYear.format(day.date)}
                      </span>
                      <Badge variant="secondary" className="text-[10px] tabular-nums">
                        {day.lessons.length + day.demos.length}
                      </Badge>
                    </div>
                    <div className="divide-y divide-border/50">
                      {day.lessons.map((lesson) => {
                        const endTime = formatLessonEndTime(
                          lesson.scheduledAt,
                          lesson.durationMinutes,
                          language,
                        );
                        return (
                          <div
                            key={lesson.id}
                            className="flex flex-col justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center"
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-28 shrink-0 text-xs font-bold tabular-nums text-foreground">
                                {formatAcademyDate(lesson.scheduledAt, language, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                                {endTime ? ` – ${endTime}` : ''}
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-foreground">
                                    {lesson.groupName || t('noGroup')}
                                  </span>
                                  <LessonStatusBadge status={lesson.status} />
                                </div>
                                <p className="truncate text-xs text-muted-foreground">
                                  {lesson.topic}
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onOpenAttendance(String(lesson.id))}
                            >
                              <ClipboardCheck className="mr-1.5 size-3.5" />
                              {t('attendanceLabel')}
                            </Button>
                          </div>
                        );
                      })}
                      {day.demos.map((demo) => (
                        <div
                          key={`demo-${demo.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-28 shrink-0 text-xs font-bold tabular-nums">
                              {formatAcademyDate(demo.scheduledAt, language, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <div>
                              <span className="text-sm font-semibold text-foreground">
                                {demo.courseName || t('demoLesson')}
                              </span>
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                {t('demoLesson')}
                              </Badge>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onSelectDemo?.(demo)}
                          >
                            {t('details')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}
