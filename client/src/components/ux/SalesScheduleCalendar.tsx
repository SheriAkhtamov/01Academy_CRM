/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  addWeeks,
  format,
  isSameDay,
  isSameWeek,
  startOfWeek,
} from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import {
  BookOpen,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Minus,
  UserRoundCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import {
  buildSalesScheduleFilterTree,
  buildSalesScheduleEvents,
  getGroupSelectionState,
  getGroupsWithSchedule,
  positionOverlappingScheduleEvents,
  type PositionedScheduleEvent,
  type SalesScheduleCourse,
  type SalesScheduleGroup,
  type SalesScheduleLesson,
  type SalesScheduleSchool,
} from '@/lib/salesSchedule';

interface SalesScheduleCalendarProps {
  groups: SalesScheduleGroup[];
  lessons: SalesScheduleLesson[];
  courses: SalesScheduleCourse[];
  schools: SalesScheduleSchool[];
}

const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 21;
const HOUR_HEIGHT = 68;
const TIME_COLUMN_WIDTH = 64;

const GROUP_TONES = [
  {
    background: 'var(--calendar-blue-background)',
    border: 'var(--calendar-blue-border)',
    foreground: 'var(--calendar-blue-foreground)',
    solid: 'var(--calendar-blue-solid)',
  },
  {
    background: 'var(--calendar-emerald-background)',
    border: 'var(--calendar-emerald-border)',
    foreground: 'var(--calendar-emerald-foreground)',
    solid: 'var(--calendar-emerald-solid)',
  },
  {
    background: 'var(--calendar-amber-background)',
    border: 'var(--calendar-amber-border)',
    foreground: 'var(--calendar-amber-foreground)',
    solid: 'var(--calendar-amber-solid)',
  },
  {
    background: 'var(--calendar-violet-background)',
    border: 'var(--calendar-violet-border)',
    foreground: 'var(--calendar-violet-foreground)',
    solid: 'var(--calendar-violet-solid)',
  },
  {
    background: 'var(--calendar-rose-background)',
    border: 'var(--calendar-rose-border)',
    foreground: 'var(--calendar-rose-foreground)',
    solid: 'var(--calendar-rose-solid)',
  },
  {
    background: 'var(--calendar-cyan-background)',
    border: 'var(--calendar-cyan-border)',
    foreground: 'var(--calendar-cyan-foreground)',
    solid: 'var(--calendar-cyan-solid)',
  },
] as const;

const formatMinutes = (minutes: number) => (
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
);

const getEventPositionStyle = (
  event: PositionedScheduleEvent,
  startHour: number,
) => {
  const dayWidth = `(100% - ${TIME_COLUMN_WIDTH}px) / 7`;
  const laneWidth = `(${dayWidth}) / ${event.laneCount}`;
  const top = ((event.startMinutes - startHour * 60) / 60) * HOUR_HEIGHT;
  const height = Math.max(38, ((event.endMinutes - event.startMinutes) / 60) * HOUR_HEIGHT - 4);

  return {
    left: `calc(${TIME_COLUMN_WIDTH}px + (${dayWidth}) * ${event.dayIndex} + (${laneWidth}) * ${event.lane} + 3px)`,
    width: `calc(${laneWidth} - 6px)`,
    top,
    height,
  };
};

export function SalesScheduleCalendar({
  groups,
  lessons,
  courses,
  schools,
}: SalesScheduleCalendarProps) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? ru : enUS;
  const initialWeekStart = useMemo(
    () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    [],
  );
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [now, setNow] = useState(() => new Date());
  const dayNames = [
    t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort'),
  ];
  const scheduleGroups = useMemo(
    () => getGroupsWithSchedule(groups, lessons),
    [groups, lessons],
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(
    () => new Set(scheduleGroups.map((group) => group.id)),
  );
  const knownGroupIdsRef = useRef(new Set(scheduleGroups.map((group) => group.id)));
  const filterTree = useMemo(
    () => buildSalesScheduleFilterTree(scheduleGroups, schools, courses),
    [courses, scheduleGroups, schools],
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
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const allEvents = useMemo(
    () => buildSalesScheduleEvents({ groups: scheduleGroups, lessons, weekStart }),
    [lessons, scheduleGroups, weekStart],
  );
  const visibleEvents = useMemo(
    () => allEvents.filter((event) => selectedGroupIds.has(event.groupId)),
    [allEvents, selectedGroupIds],
  );
  const positionedEvents = useMemo(
    () => days.flatMap((_, dayIndex) => positionOverlappingScheduleEvents(
      visibleEvents.filter((event) => event.dayIndex === dayIndex),
    )),
    [days, visibleEvents],
  );
  const groupIndexById = useMemo(
    () => new Map(scheduleGroups.map((group, index) => [group.id, index])),
    [scheduleGroups],
  );

  const startHour = useMemo(() => {
    if (visibleEvents.length === 0) return DEFAULT_START_HOUR;
    return Math.max(0, Math.min(
      DEFAULT_START_HOUR,
      Math.floor(Math.min(...visibleEvents.map((event) => event.startMinutes)) / 60),
    ));
  }, [visibleEvents]);
  const endHour = useMemo(() => {
    if (visibleEvents.length === 0) return DEFAULT_END_HOUR;
    return Math.min(24, Math.max(
      DEFAULT_END_HOUR,
      Math.ceil(Math.max(...visibleEvents.map((event) => event.endMinutes)) / 60),
    ));
  }, [visibleEvents]);
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index),
    [endHour, startHour],
  );
  const calendarHeight = (endHour - startHour) * HOUR_HEIGHT;
  const allSelected = scheduleGroups.length > 0 && selectedGroupIds.size === scheduleGroups.length;
  const showCurrentTime = isSameWeek(now, weekStart, { weekStartsOn: 1 })
    && now.getHours() >= startHour
    && now.getHours() < endHour;
  const currentTimeTop = (
    ((now.getHours() * 60 + now.getMinutes()) - startHour * 60) / 60
  ) * HOUR_HEIGHT;

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

  const availableSeats = (group: SalesScheduleGroup) => Math.max(
    0,
    Number(group.maxStudents ?? 12) - Number(group.currentStudents ?? 0) - Number(group.reservedStudents ?? 0),
  );
  const groupScheduleSummary = (group: SalesScheduleGroup) => (group.schedule ?? [])
    .map((item) => {
      const day = dayNames[Number(item.dayOfWeek) - 1];
      const start = item.startTime ?? item.time ?? '';
      const end = item.endTime ? `–${item.endTime}` : '';
      return `${day} ${start}${end}`.trim();
    })
    .join(', ');

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-1 gap-4 overflow-y-auto overscroll-y-contain lg:grid-cols-[18rem_minmax(0,1fr)] lg:overflow-hidden">
      <Card className="flex min-h-64 max-h-80 flex-col lg:h-full lg:min-h-0 lg:max-h-none">
        <CardHeader className="shrink-0 gap-3 pb-3">
          <div>
            <CardTitle>{t('scheduleFilters')}</CardTitle>
            <CardDescription>
              {selectedGroupIds.size} {t('ofLabel')} {scheduleGroups.length} {t('groupsSelected')}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={allSelected}
              onClick={() => setSelectedGroupIds(new Set(scheduleGroups.map((group) => group.id)))}
            >
              {t('selectAll')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={selectedGroupIds.size === 0}
              onClick={() => setSelectedGroupIds(new Set())}
            >
              {t('clearAll')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden pt-0">
          {scheduleGroups.length > 0 ? (
            <ScrollArea className="h-auto max-h-80 lg:h-full lg:max-h-none">
              <div className="flex flex-col gap-2 pr-3">
                {filterTree.map((school) => {
                  const schoolGroupIds = school.courses.flatMap((course) => (
                    course.groups.map((group) => group.id)
                  ));
                  const schoolState = getGroupSelectionState(schoolGroupIds, selectedGroupIds);

                  return (
                    <div key={school.key} className="flex flex-col gap-1">
                      <Label
                        htmlFor={`sales-schedule-${school.key}`}
                        className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2 font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
                      >
                        <span className="relative flex size-4 shrink-0 items-center justify-center">
                          <Checkbox
                            id={`sales-schedule-${school.key}`}
                            checked={schoolState}
                            onCheckedChange={(value) => toggleGroups(schoolGroupIds, value === true)}
                            className="[&[data-state=indeterminate]_svg]:hidden"
                          />
                          {schoolState === 'indeterminate' ? (
                            <Minus className="pointer-events-none absolute size-3 text-primary" />
                          ) : null}
                        </span>
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate text-sm">
                          {school.name || t('schoolNotSelected')}
                        </span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {schoolGroupIds.filter((id) => selectedGroupIds.has(id)).length}/{schoolGroupIds.length}
                        </span>
                      </Label>

                      <div className="flex flex-col gap-1 pl-4">
                        {school.courses.map((course) => {
                          const courseGroupIds = course.groups.map((group) => group.id);
                          const courseState = getGroupSelectionState(courseGroupIds, selectedGroupIds);

                          return (
                            <div key={course.key} className="flex flex-col gap-0.5">
                              <Label
                                htmlFor={`sales-schedule-${course.key}`}
                                className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring"
                              >
                                <span className="relative flex size-4 shrink-0 items-center justify-center">
                                  <Checkbox
                                    id={`sales-schedule-${course.key}`}
                                    checked={courseState}
                                    onCheckedChange={(value) => toggleGroups(courseGroupIds, value === true)}
                                    className="[&[data-state=indeterminate]_svg]:hidden"
                                  />
                                  {courseState === 'indeterminate' ? (
                                    <Minus className="pointer-events-none absolute size-3 text-primary" />
                                  ) : null}
                                </span>
                                <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 truncate text-xs font-medium">
                                  {course.name || t('noCourse')}
                                </span>
                              </Label>

                              <div className="flex flex-col gap-0.5 pl-6">
                                {course.groups.map((group) => {
                                  const checked = selectedGroupIds.has(group.id);
                                  const groupIndex = groupIndexById.get(group.id) ?? 0;
                                  const tone = GROUP_TONES[groupIndex % GROUP_TONES.length];
                                  return (
                                    <Label
                                      key={group.id}
                                      htmlFor={`sales-schedule-group-${group.id}`}
                                      className={cn(
                                        'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5',
                                        'hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring',
                                        checked ? 'bg-muted/30' : 'opacity-60',
                                      )}
                                    >
                                      <Checkbox
                                        id={`sales-schedule-group-${group.id}`}
                                        checked={checked}
                                        onCheckedChange={(value) => toggleGroup(group.id, value === true)}
                                      />
                                      <span
                                        className="size-2.5 shrink-0 rounded-full"
                                        style={{ backgroundColor: tone.solid }}
                                        aria-hidden="true"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-foreground">
                                          {group.name}
                                        </span>
                                        <span className="block truncate text-[11px] text-muted-foreground">
                                          {group.schoolName || t('schoolNotSelected')} · {groupScheduleSummary(group)} · {availableSeats(group)}/{group.maxStudents ?? 12} {t('seatsAvailable')}
                                        </span>
                                      </span>
                                    </Label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
              <CalendarDays className="text-muted-foreground" />
              <p className="text-sm font-medium">{t('noScheduledGroups')}</p>
              <p className="text-xs text-muted-foreground">{t('noScheduledGroupsDescription')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden lg:h-full lg:min-h-0">
        <CardHeader className="shrink-0 flex flex-col gap-3 border-b border-border sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('weeklySchedule')}</CardTitle>
            <CardDescription>
              {format(days[0], 'd MMMM', { locale })} — {format(days[6], 'd MMMM yyyy', { locale })}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSameWeek(weekStart, initialWeekStart, { weekStartsOn: 1 })}
              onClick={() => setWeekStart(initialWeekStart)}
            >
              {t('today')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setWeekStart((current) => addWeeks(current, -1))}
            >
              <ChevronLeft />
              <span className="sr-only">{t('previousWeek')}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setWeekStart((current) => addWeeks(current, 1))}
            >
              <ChevronRight />
              <span className="sr-only">{t('nextWeek')}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-0">
          <div className="h-full overflow-auto overscroll-contain [scrollbar-gutter:stable]">
            <div className="min-w-[820px]">
              <div className="sticky top-0 z-20 grid grid-cols-[4rem_repeat(7,minmax(6.75rem,1fr))] border-b border-border bg-card">
                <div className="border-r border-border" />
                {days.map((day) => {
                  const today = isSameDay(day, now);
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        'flex min-h-16 flex-col items-center justify-center border-r border-border px-2 last:border-r-0',
                        today ? 'bg-primary/5' : 'bg-card',
                      )}
                    >
                      <span className={cn(
                        'text-[11px] font-medium uppercase text-muted-foreground',
                        today && 'text-primary',
                      )}>
                        {format(day, 'EEE', { locale })}
                      </span>
                      <span className={cn(
                        'mt-1 flex size-8 items-center justify-center rounded-full text-sm font-semibold',
                        today ? 'bg-primary text-primary-foreground' : 'text-foreground',
                      )}>
                        {format(day, 'd')}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="relative bg-card" style={{ height: calendarHeight }}>
                <div
                  className="absolute inset-y-0 right-0 grid grid-cols-7"
                  style={{ left: TIME_COLUMN_WIDTH }}
                  aria-hidden="true"
                >
                  {days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        'border-r border-border last:border-r-0',
                        isSameDay(day, now) && 'bg-primary/[0.035]',
                      )}
                    />
                  ))}
                </div>

                {hours.map((hour) => {
                  const top = (hour - startHour) * HOUR_HEIGHT;
                  return (
                    <div key={hour}>
                      <span
                        className="absolute left-0 w-14 -translate-y-1/2 pr-2 text-right text-[11px] tabular-nums text-muted-foreground"
                        style={{ top: hour === startHour ? 8 : top }}
                      >
                        {String(hour).padStart(2, '0')}:00
                      </span>
                      <div
                        className="absolute right-0 border-t border-border"
                        style={{ left: TIME_COLUMN_WIDTH, top }}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}

                <TooltipProvider delayDuration={800}>
                  {positionedEvents.map((event) => {
                    const groupIndex = groupIndexById.get(event.groupId) ?? 0;
                    const tone = GROUP_TONES[groupIndex % GROUP_TONES.length];
                    const compact = event.endMinutes - event.startMinutes < 60;
                    return (
                      <Tooltip key={event.id}>
                        <TooltipTrigger asChild>
                          <article
                            tabIndex={0}
                            className="absolute z-10 overflow-hidden rounded-md border px-2 py-1.5 text-left shadow-2xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                            style={{
                              ...getEventPositionStyle(event, startHour),
                              backgroundColor: tone.background,
                              borderColor: tone.border,
                              color: tone.foreground,
                            }}
                            aria-label={`${formatMinutes(event.startMinutes)}–${formatMinutes(event.endMinutes)}, ${event.groupName}`}
                          >
                            <p className="truncate text-[11px] font-semibold tabular-nums">
                              {formatMinutes(event.startMinutes)}–{formatMinutes(event.endMinutes)}
                            </p>
                            <p className="truncate text-xs font-semibold">{event.groupName}</p>
                            {!compact ? (
                              <>
                                <p className="truncate text-[11px] opacity-80">
                                  {event.topic || event.courseName || t('lessonColumn')}
                                </p>
                                <p className="truncate text-[10px] opacity-75">
                                  {event.teacherName || t('teacherWillBeAssigned')}
                                </p>
                                {event.availableSeats !== null && event.availableSeats !== undefined ? (
                                  <p className="truncate text-[10px] opacity-75">
                                    {event.availableSeats}/{event.maxStudents ?? 12} {t('seatsAvailable')}
                                  </p>
                                ) : null}
                              </>
                            ) : null}
                          </article>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-72">
                          <div className="flex flex-col gap-2">
                            <div>
                              <p className="font-semibold">{event.groupName}</p>
                              <p className="text-xs text-muted-foreground">
                                {event.topic || event.courseName || t('lessonColumn')}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <Clock3 className="size-3.5" />
                              {formatMinutes(event.startMinutes)}–{formatMinutes(event.endMinutes)}
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <UserRoundCheck className="size-3.5" />
                              {event.teacherName || t('teacherWillBeAssigned')}
                            </div>
                            {event.schoolName ? (
                              <div className="flex items-center gap-2 text-xs">
                                <MapPin className="size-3.5" />
                                {event.schoolName}
                              </div>
                            ) : null}
                            {event.availableSeats !== null && event.availableSeats !== undefined ? (
                              <div className="flex items-center gap-2 text-xs">
                                <UserRoundCheck className="size-3.5" />
                                {event.availableSeats}/{event.maxStudents ?? 12} {t('seatsAvailable')}
                              </div>
                            ) : null}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </TooltipProvider>

                {showCurrentTime ? (
                  <div
                    className="pointer-events-none absolute right-0 z-20 border-t border-destructive"
                    style={{ left: TIME_COLUMN_WIDTH, top: currentTimeTop }}
                    aria-hidden="true"
                  >
                    <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-destructive" />
                  </div>
                ) : null}

                {selectedGroupIds.size === 0 || positionedEvents.length === 0 ? (
                  <div
                    className="absolute inset-x-20 top-20 z-10 flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/95 p-5 text-center"
                  >
                    <CalendarDays className="text-muted-foreground" />
                    <p className="text-sm font-medium">{t('noLessonsThisWeek')}</p>
                    <p className="max-w-md text-xs text-muted-foreground">
                      {selectedGroupIds.size === 0
                        ? t('selectGroupsToSeeSchedule')
                        : t('noLessonsThisWeekDescription')}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
