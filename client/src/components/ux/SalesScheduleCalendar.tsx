/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  isSameWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import {
  AlertCircle,
  CalendarDays,
  LoaderCircle,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { useCalendarPreference } from '@/hooks/useCalendarPreference';
import { useCalendarShortcuts } from '@/hooks/useCalendarShortcuts';
import { useIsCompactViewport } from '@/hooks/useMediaQuery';
import {
  demoLessonQueryKeys,
  demoLessonsApi,
  type DemoLesson,
} from '@/features/demo-lessons/api';
import {
  DemoLessonDialog,
  type DemoLessonDialogLead,
} from '@/components/ux/DemoLessonDialog';
import { DemoLessonDetailsDialog } from '@/components/ux/DemoLessonDetailsDialog';
import { CalendarNavigator } from '@/components/ux/calendar/CalendarNavigator';
import { ScheduleAgendaList } from '@/components/ux/calendar/ScheduleAgendaList';
import { ScheduleEventDialog } from '@/components/ux/calendar/ScheduleEventDialog';
import { ScheduleFilterPanel } from '@/components/ux/calendar/ScheduleFilterPanel';
import { ScheduleMonthGrid } from '@/components/ux/calendar/ScheduleMonthGrid';
import {
  ScheduleTimeGrid,
  SCHEDULE_HOUR_HEIGHT,
} from '@/components/ux/calendar/ScheduleTimeGrid';
import { buildCalendarTimeScale } from '@/lib/calendarTimeScale';
import {
  CALENDAR_VIEW_MODES,
  type CalendarViewMode,
} from '@/lib/calendarPreferences';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  buildSalesScheduleFilterTree,
  buildSalesScheduleRangeEvents,
  buildSalesScheduleTeacherOptions,
  filterSalesScheduleEventsByTeachers,
  getGroupsWithSchedule,
  groupSalesScheduleEventsByDate,
  positionOverlappingScheduleEvents,
  type SalesScheduleCourse,
  type SalesScheduleEvent,
  type SalesScheduleGroup,
  type SalesScheduleLesson,
  type SalesScheduleSchool,
} from '@/lib/salesSchedule';

interface SalesScheduleCalendarProps {
  groups: SalesScheduleGroup[];
  lessons: SalesScheduleLesson[];
  courses: SalesScheduleCourse[];
  schools: SalesScheduleSchool[];
  leads: DemoLessonDialogLead[];
}

const VIEWS = CALENDAR_VIEW_MODES;
const MONTH_CELL_COUNT = 42;
const FILTER_STATES = ['open', 'closed'] as const;
const STEP_LABEL_KEYS = {
  day: { previousKey: 'previousDay', nextKey: 'nextDay' },
  week: { previousKey: 'previousWeek', nextKey: 'nextWeek' },
  agenda: { previousKey: 'previousWeek', nextKey: 'nextWeek' },
  month: { previousKey: 'previousMonth', nextKey: 'nextMonth' },
} satisfies Record<
  CalendarViewMode,
  { previousKey: TranslationKey; nextKey: TranslationKey }
>;

const dateKey = (day: Date) => (
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
);
const timeValue = (minutes: number) => (
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
);

export function SalesScheduleCalendar({
  groups,
  lessons,
  courses,
  schools,
  leads,
}: SalesScheduleCalendarProps) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? ru : enUS;
  const isCompactViewport = useIsCompactViewport();
  const [view, setView] = useCalendarPreference<CalendarViewMode>(
    'salesScheduleView',
    VIEWS,
    isCompactViewport ? 'agenda' : 'week',
  );
  const [filterState, setFilterState] = useCalendarPreference(
    'salesScheduleFilters',
    FILTER_STATES,
    'open',
  );
  const filtersOpen = filterState === 'open';
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [now, setNow] = useState(() => new Date());
  const [createDemoOpen, setCreateDemoOpen] = useState(false);
  const [demoDraft, setDemoDraft] = useState<{ date: string; time: string } | null>(null);
  const [selectedDemoId, setSelectedDemoId] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SalesScheduleEvent | null>(null);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<number>>(() => new Set());

  const weekStart = useMemo(() => startOfWeek(cursor, { weekStartsOn: 1 }), [cursor]);
  const monthAnchor = useMemo(() => startOfMonth(cursor), [cursor]);
  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(cursor), days: 1 };
    if (view === 'month') {
      return {
        start: startOfWeek(monthAnchor, { weekStartsOn: 1 }),
        days: MONTH_CELL_COUNT,
      };
    }
    return { start: weekStart, days: 7 };
  }, [cursor, monthAnchor, view, weekStart]);
  const rangeDays = useMemo(
    () => Array.from({ length: range.days }, (_, index) => addDays(range.start, index)),
    [range],
  );
  const rangeEnd = useMemo(() => addDays(range.start, range.days), [range]);

  const demosQuery = useQuery<DemoLesson[]>({
    queryKey: [...demoLessonQueryKeys.all, range.start.toISOString(), rangeEnd.toISOString()],
    queryFn: () => demoLessonsApi.list({
      from: range.start.toISOString(),
      to: rangeEnd.toISOString(),
    }),
  });
  const demos = useMemo(() => demosQuery.data ?? [], [demosQuery.data]);
  const selectedDemo = useMemo(
    () => demos.find((demo) => demo.id === selectedDemoId) ?? null,
    [demos, selectedDemoId],
  );

  const dayNames = [
    t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort'),
  ];
  const scheduleGroups = useMemo(
    () => getGroupsWithSchedule(groups, lessons),
    [groups, lessons],
  );
  const scheduleGroupIds = useMemo(
    () => new Set(scheduleGroups.map((group) => group.id)),
    [scheduleGroups],
  );
  const scheduleLessons = useMemo(
    () => lessons.filter((lesson) => scheduleGroupIds.has(lesson.groupId)),
    [lessons, scheduleGroupIds],
  );
  const teacherOptions = useMemo(
    () => buildSalesScheduleTeacherOptions(scheduleGroups, scheduleLessons, demos),
    [demos, scheduleGroups, scheduleLessons],
  );
  const teacherIds = useMemo(
    () => new Set(teacherOptions.map((teacher) => teacher.id)),
    [teacherOptions],
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(
    () => new Set(scheduleGroups.map((group) => group.id)),
  );
  const knownGroupIdsRef = useRef(new Set(scheduleGroups.map((group) => group.id)));
  const filterTree = useMemo(
    () => buildSalesScheduleFilterTree(scheduleGroups, schools, courses),
    [courses, scheduleGroups, schools],
  );
  const groupIndexById = useMemo(
    () => new Map(scheduleGroups.map((group, index) => [group.id, index])),
    [scheduleGroups],
  );

  useEffect(() => {
    const nextIds = new Set(scheduleGroups.map((group) => group.id));
    setSelectedGroupIds((current) => {
      const next = new Set([...current].filter((id) => nextIds.has(id)));
      for (const id of nextIds) {
        if (!knownGroupIdsRef.current.has(id)) next.add(id);
      }
      return next;
    });
    knownGroupIdsRef.current = nextIds;
  }, [scheduleGroups]);

  useEffect(() => {
    setSelectedTeacherIds((current) => {
      const next = new Set([...current].filter((id) => teacherIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [teacherIds]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const rangeEvents = useMemo(
    () => buildSalesScheduleRangeEvents({
      groups: scheduleGroups,
      lessons: scheduleLessons,
      demos,
      rangeStart: range.start,
      dayCount: range.days,
    }),
    [demos, range, scheduleGroups, scheduleLessons],
  );
  const groupFilteredEvents = useMemo(
    () => rangeEvents.filter((event) => (
      event.source === 'demo' || selectedGroupIds.has(event.groupId)
    )),
    [rangeEvents, selectedGroupIds],
  );
  const teacherEventCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const event of groupFilteredEvents) {
      if (!event.teacherId) continue;
      counts.set(event.teacherId, (counts.get(event.teacherId) ?? 0) + 1);
    }
    return counts;
  }, [groupFilteredEvents]);
  const visibleEvents = useMemo(
    () => filterSalesScheduleEventsByTeachers(groupFilteredEvents, selectedTeacherIds),
    [groupFilteredEvents, selectedTeacherIds],
  );
  const positionedEvents = useMemo(
    () => rangeDays.flatMap((_, dayIndex) => positionOverlappingScheduleEvents(
      visibleEvents.filter((event) => event.dayIndex === dayIndex),
    )),
    [rangeDays, visibleEvents],
  );
  const eventsByDate = useMemo(
    () => groupSalesScheduleEventsByDate(visibleEvents),
    [visibleEvents],
  );

  // Built from every event in range, not from the filtered ones: a scale that
  // rescales itself on each checkbox made lessons jump around under the cursor.
  const timeScale = useMemo(
    () => buildCalendarTimeScale(rangeEvents, { hourSize: SCHEDULE_HOUR_HEIGHT }),
    [rangeEvents],
  );

  const step = view === 'day' ? 1 : 7;
  const goPrevious = useCallback(() => {
    setCursor((current) => (
      view === 'month' ? addMonths(current, -1) : addDays(current, -step)
    ));
  }, [step, view]);
  const goNext = useCallback(() => {
    setCursor((current) => (
      view === 'month' ? addMonths(current, 1) : addDays(current, step)
    ));
  }, [step, view]);
  const goToday = useCallback(() => setCursor(startOfDay(new Date())), []);
  const changeViewByIndex = useCallback((index: number) => {
    const nextView = VIEWS[index];
    if (nextView) setView(nextView);
  }, [setView]);

  useCalendarShortcuts({
    onPrevious: goPrevious,
    onNext: goNext,
    onToday: goToday,
    onView: changeViewByIndex,
  });

  const atToday = view === 'day'
    ? isSameDay(cursor, now)
    : view === 'month'
      ? isSameMonth(cursor, now)
      : isSameWeek(cursor, now, { weekStartsOn: 1 });
  const rangeLabel = view === 'day'
    ? format(cursor, 'EEEE, d MMMM yyyy', { locale })
    : view === 'month'
      ? format(monthAnchor, 'LLLL yyyy', { locale })
      : `${format(rangeDays[0], 'd MMM', { locale })} — ${format(rangeDays[6], 'd MMM yyyy', { locale })}`;
  const stepLabelKey = STEP_LABEL_KEYS[view];

  const toggleGroup = (groupId: number, checked: boolean) => {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (checked) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  };

  const toggleGroups = (groupIds: number[], checked: boolean) => {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      for (const groupId of groupIds) {
        if (checked) next.add(groupId);
        else next.delete(groupId);
      }
      return next;
    });
  };

  const toggleTeacher = (teacherId: number, checked: boolean) => {
    setSelectedTeacherIds((current) => {
      const next = new Set(current);
      if (checked) next.add(teacherId);
      else next.delete(teacherId);
      return next;
    });
  };

  const openDemoCreation = (day?: Date, minutes?: number) => {
    setDemoDraft(day && minutes !== undefined
      ? { date: dateKey(day), time: timeValue(minutes) }
      : null);
    setCreateDemoOpen(true);
  };

  const selectEvent = (event: SalesScheduleEvent) => {
    if (event.demoLessonId) setSelectedDemoId(event.demoLessonId);
    else setSelectedEvent(event);
  };

  const hiddenFilterCount = (scheduleGroups.length - selectedGroupIds.size)
    + selectedTeacherIds.size;

  const emptyState = (
    <div className="flex max-w-md flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/95 px-5 py-6 text-center shadow-2xs">
      <CalendarDays className="text-muted-foreground" />
      <p className="text-sm font-medium">{t('noLessonsThisWeek')}</p>
      <p className="text-xs text-muted-foreground">
        {selectedGroupIds.size === 0 && demos.length === 0
          ? t('selectGroupsToSeeSchedule')
          : selectedTeacherIds.size > 0
            ? t('noLessonsForSelectedTeachers')
            : t('noLessonsThisWeekDescription')}
      </p>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-y-contain lg:overflow-hidden">
      <Card className="shrink-0">
        <CardHeader className="gap-3 px-3 py-2.5 sm:px-4">
          <CalendarNavigator
            label={rangeLabel}
            hint={demosQuery.isFetching ? (
              <span className="inline-flex items-center gap-1">
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                {t('loading')}
              </span>
            ) : null}
            previousLabel={t(stepLabelKey.previousKey)}
            nextLabel={t(stepLabelKey.nextKey)}
            atToday={atToday}
            onPrevious={goPrevious}
            onNext={goNext}
            onToday={goToday}
            views={VIEWS}
            view={view}
            onViewChange={setView}
            actions={(
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant={filtersOpen ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-8 gap-1.5 px-2.5"
                  aria-pressed={filtersOpen}
                  onClick={() => setFilterState(filtersOpen ? 'closed' : 'open')}
                >
                  <SlidersHorizontal />
                  <span className="hidden sm:inline">{t('scheduleFilters')}</span>
                  {hiddenFilterCount > 0 ? (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold tabular-nums text-primary-foreground">
                      {hiddenFilterCount}
                    </span>
                  ) : null}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 px-2.5"
                  onClick={() => openDemoCreation()}
                >
                  <Plus />
                  <span className="hidden sm:inline">{t('createDemoLesson')}</span>
                </Button>
              </div>
            )}
          />
        </CardHeader>
      </Card>

      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 gap-3',
          filtersOpen && 'lg:grid-cols-[17rem_minmax(0,1fr)]',
        )}
      >
        {filtersOpen ? (
          <Card className="flex max-h-[26rem] min-h-0 flex-col p-3 lg:max-h-none lg:h-full">
            <ScheduleFilterPanel
              filterTree={filterTree}
              groupCount={scheduleGroups.length}
              eventCount={visibleEvents.length}
              selectedGroupIds={selectedGroupIds}
              groupIndexById={groupIndexById}
              dayNames={dayNames}
              teachers={teacherOptions}
              selectedTeacherIds={selectedTeacherIds}
              teacherEventCounts={teacherEventCounts}
              onToggleGroup={toggleGroup}
              onToggleGroups={toggleGroups}
              onSelectAllGroups={() => setSelectedGroupIds(
                new Set(scheduleGroups.map((group) => group.id)),
              )}
              onClearGroups={() => setSelectedGroupIds(new Set())}
              onToggleTeacher={toggleTeacher}
              onClearTeachers={() => setSelectedTeacherIds(new Set())}
            />
          </Card>
        ) : null}

        <Card className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden lg:h-full lg:min-h-0">
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            {demosQuery.isError ? (
              <div
                role="alert"
                className="flex shrink-0 flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <span>{t('failedToLoadData')}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7"
                  disabled={demosQuery.isFetching}
                  onClick={() => void demosQuery.refetch()}
                >
                  {t('retry')}
                </Button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1">
              {view === 'month' ? (
                <ScheduleMonthGrid
                  days={rangeDays}
                  monthAnchor={monthAnchor}
                  eventsByDate={eventsByDate}
                  now={now}
                  locale={locale}
                  dayNames={dayNames}
                  groupIndexById={groupIndexById}
                  onSelectEvent={selectEvent}
                  onSelectDay={(day) => {
                    setCursor(startOfDay(day));
                    setView('day');
                  }}
                />
              ) : view === 'agenda' ? (
                <ScheduleAgendaList
                  days={rangeDays}
                  eventsByDate={eventsByDate}
                  now={now}
                  locale={locale}
                  groupIndexById={groupIndexById}
                  onSelectEvent={selectEvent}
                  emptyState={emptyState}
                />
              ) : (
                <ScheduleTimeGrid
                  days={rangeDays}
                  events={positionedEvents}
                  timeScale={timeScale}
                  now={now}
                  locale={locale}
                  groupIndexById={groupIndexById}
                  onSelectEvent={selectEvent}
                  onCreateAt={(day, minutes) => openDemoCreation(day, minutes)}
                  emptyState={emptyState}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <DemoLessonDialog
        open={createDemoOpen}
        onOpenChange={(nextOpen) => {
          setCreateDemoOpen(nextOpen);
          if (!nextOpen) setDemoDraft(null);
        }}
        leads={leads}
        initialDate={demoDraft?.date}
        initialTime={demoDraft?.time}
        courses={courses.flatMap((course) => (
          course.name ? [{ id: course.id, name: course.name }] : []
        ))}
        schools={schools}
      />
      <DemoLessonDetailsDialog
        demo={selectedDemo}
        open={Boolean(selectedDemo)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedDemoId(null);
        }}
      />
      <ScheduleEventDialog
        event={selectedEvent}
        open={Boolean(selectedEvent)}
        locale={locale}
        groupIndexById={groupIndexById}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedEvent(null);
        }}
      />
    </div>
  );
}
