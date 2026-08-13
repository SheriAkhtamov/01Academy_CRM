import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { DoorOpen, Search, SearchX, UsersRound, Wifi } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { useCalendarShortcuts } from '@/hooks/useCalendarShortcuts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CalendarNavigator } from '@/components/ux/calendar/CalendarNavigator';
import { CALENDAR_TONES, formatCalendarMinutes } from '@/components/ux/calendar/calendarTones';
import { assignCalendarLanes } from '@/lib/calendarLanes';
import {
  buildCalendarTimeScale,
  getCalendarMinutePosition,
  isCalendarMinuteCollapsed,
} from '@/lib/calendarTimeScale';

interface SchoolOption {
  id: number;
  name: string;
  isActive?: boolean;
}

interface ScheduleItem {
  dayOfWeek: number;
  startTime?: string;
  endTime?: string;
  time?: string;
}

interface ResourceGroup {
  id: number;
  name: string;
  courseName?: string | null;
  teacherName?: string | null;
  durationMinutes?: number | null;
  schedule: ScheduleItem[];
}

interface ResourceLesson {
  id: number;
  groupId: number;
  groupName?: string | null;
  courseName?: string | null;
  teacherName?: string | null;
  scheduledAt: string;
  durationMinutes?: number | null;
}

interface ResourceDemoLesson {
  id: number;
  courseName?: string | null;
  teacherName?: string | null;
  scheduledAt: string;
  durationMinutes?: number | null;
  participantCount?: number | null;
  status?: string | null;
}

interface ResourceRoom {
  id: number;
  name: string;
  capacity: number;
  isOnline?: boolean;
  groups: ResourceGroup[];
  lessons: ResourceLesson[];
  demos: ResourceDemoLesson[];
}

interface ResourceScheduleResponse {
  date: string;
  rooms: ResourceRoom[];
  onlineDemos?: ResourceDemoLesson[];
}

interface CalendarEvent {
  id: string;
  source: 'group' | 'lesson' | 'demo';
  name: string;
  courseName?: string | null;
  teacherName?: string | null;
  participantCount?: number | null;
  startMinutes: number;
  endMinutes: number;
}

const START_HOUR = 9;
const END_HOUR = 21;
const HOUR_WIDTH = 80;
const COLLAPSED_GAP_WIDTH = 128;
const EMPTY_TIMELINE_WIDTH = 360;
const RESOURCE_COLUMN_WIDTH = 13 * 16;
const LANE_HEIGHT = 44;
const ROW_PADDING = 12;

const SOURCE_TONES = {
  group: CALENDAR_TONES[0],
  lesson: CALENDAR_TONES[2],
  demo: CALENDAR_TONES[3],
} as const;

const toDateInput = (value: Date) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const toMinutes = (value: string | undefined) => {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const dayOfWeek = (date: Date) => date.getDay() || 7;

const buildRoomEvents = (room: ResourceRoom, selectedDate: string): CalendarEvent[] => {
  const date = new Date(`${selectedDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return [];
  const actualGroupIds = new Set(room.lessons.map((lesson) => lesson.groupId));
  const recurring = room.groups.flatMap((group) =>
    actualGroupIds.has(group.id)
      ? []
      : (group.schedule ?? []).flatMap((item, index) => {
          if (Number(item.dayOfWeek) !== dayOfWeek(date)) return [];
          const startMinutes = toMinutes(item.startTime ?? item.time);
          if (startMinutes === null) return [];
          const explicitEnd = toMinutes(item.endTime);
          const endMinutes = explicitEnd && explicitEnd > startMinutes
            ? explicitEnd
            : startMinutes + Number(group.durationMinutes ?? 120);
          return [{
            id: `group-${group.id}-${index}`,
            source: 'group' as const,
            name: group.name,
            courseName: group.courseName,
            teacherName: group.teacherName,
            startMinutes,
            endMinutes,
          }];
        }),
  );
  const lessons = room.lessons.flatMap((lesson) => {
    const startsAt = new Date(lesson.scheduledAt);
    if (Number.isNaN(startsAt.getTime())) return [];
    const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
    return [{
      id: `lesson-${lesson.id}`,
      source: 'lesson' as const,
      name: lesson.groupName || `#${lesson.groupId}`,
      courseName: lesson.courseName,
      teacherName: lesson.teacherName,
      startMinutes,
      endMinutes: startMinutes + Number(lesson.durationMinutes ?? 120),
    }];
  });

  const demos = (room.demos ?? []).flatMap((demo) => {
    const startsAt = new Date(demo.scheduledAt);
    if (Number.isNaN(startsAt.getTime())) return [];
    const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
    return [{
      id: `demo-${demo.id}`,
      source: 'demo' as const,
      name: 'demoLesson',
      courseName: demo.courseName,
      teacherName: demo.teacherName,
      participantCount: demo.participantCount,
      startMinutes,
      endMinutes: startMinutes + Number(demo.durationMinutes ?? 60),
    }];
  });

  // Everything booked for the day is shown. Clipping to office hours used to
  // hide an early or late booking completely, which is exactly the booking a
  // room-conflict check needs to see.
  return [...recurring, ...lessons, ...demos]
    .sort((left, right) => left.startMinutes - right.startMinutes || left.name.localeCompare(right.name));
};

export function AdminScheduleCalendar({ schools }: { schools: SchoolOption[] }) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? ru : enUS;
  const activeSchools = useMemo(
    () => schools.filter((school) => school.isActive !== false),
    [schools],
  );
  const [schoolId, setSchoolId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));
  const [roomSearch, setRoomSearch] = useState('');
  const [now, setNow] = useState(() => new Date());
  const scopeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!schoolId && activeSchools[0]) setSchoolId(String(activeSchools[0].id));
  }, [activeSchools, schoolId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const shiftDay = useCallback((offset: number) => {
    setSelectedDate((current) => {
      const parsed = new Date(`${current}T00:00:00`);
      const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
      return toDateInput(addDays(base, offset));
    });
  }, []);
  const goToday = useCallback(() => setSelectedDate(toDateInput(new Date())), []);

  useCalendarShortcuts({
    onPrevious: () => shiftDay(-1),
    onNext: () => shiftDay(1),
    onToday: goToday,
    scopeRef,
  });

  const schedule = useQuery<ResourceScheduleResponse>({
    queryKey: ['/api/academy/schedule/resource', schoolId, selectedDate],
    queryFn: () => apiRequest(
      'GET',
      `/api/academy/schedule/resource?schoolId=${encodeURIComponent(schoolId)}&date=${encodeURIComponent(selectedDate)}`,
    ),
    enabled: Boolean(schoolId && selectedDate),
  });
  const resourceRows = useMemo(() => {
    const rooms = schedule.data?.rooms ?? [];
    const onlineDemos = schedule.data?.onlineDemos ?? [];
    if (onlineDemos.length === 0) return rooms;
    return [...rooms, {
      id: -1,
      name: t('online'),
      capacity: 0,
      isOnline: true,
      groups: [],
      lessons: [],
      demos: onlineDemos,
    }];
  }, [schedule.data?.onlineDemos, schedule.data?.rooms, t]);
  const eventsByRoomId = useMemo(
    () => new Map(resourceRows.map((room) => [room.id, buildRoomEvents(room, selectedDate)])),
    [resourceRows, selectedDate],
  );
  const visibleRows = useMemo(() => {
    const needle = roomSearch.trim().toLocaleLowerCase();
    if (!needle) return resourceRows;
    return resourceRows.filter((room) => room.name.toLocaleLowerCase().includes(needle));
  }, [resourceRows, roomSearch]);
  const timeScale = useMemo(() => buildCalendarTimeScale(
    resourceRows.flatMap((room) => eventsByRoomId.get(room.id) ?? []),
    {
      hourSize: HOUR_WIDTH,
      defaultStartMinutes: START_HOUR * 60,
      defaultEndMinutes: END_HOUR * 60,
      collapsedGapSize: COLLAPSED_GAP_WIDTH,
      emptyCalendarSize: EMPTY_TIMELINE_WIDTH,
    },
  ), [eventsByRoomId, resourceRows]);

  const selectedDay = useMemo(() => {
    const parsed = new Date(`${selectedDate}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? startOfDay(new Date()) : parsed;
  }, [selectedDate]);
  const isToday = isSameDay(selectedDay, now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const showCurrentTime = isToday
    && timeScale.markers.length > 0
    && currentMinutes >= timeScale.startMinutes
    && currentMinutes < timeScale.endMinutes
    && !isCalendarMinuteCollapsed(timeScale, currentMinutes);
  const bookedEventCount = useMemo(
    () => [...eventsByRoomId.values()].reduce((total, events) => total + events.length, 0),
    [eventsByRoomId],
  );

  const collapsedSegments = timeScale.segments.filter((segment) => segment.kind === 'collapsed');

  return (
    <Card className="min-w-0 overflow-hidden" ref={scopeRef}>
      <CardHeader className="gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base">{t('resourceCalendar')}</CardTitle>
            <CardDescription>{t('resourceCalendarDescription')}</CardDescription>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:w-auto md:min-w-80">
            <Select value={schoolId} onValueChange={setSchoolId}>
              <SelectTrigger className="h-9" aria-label={t('school')}>
                <SelectValue placeholder={t('selectSchool')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {activeSchools.map((school) => (
                    <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="h-9 pl-8"
                value={roomSearch}
                onChange={(event) => setRoomSearch(event.target.value)}
                placeholder={t('searchRooms')}
                aria-label={t('searchRooms')}
              />
            </div>
          </div>
        </div>

        <CalendarNavigator
          label={format(selectedDay, 'EEEE, d MMMM yyyy', { locale })}
          hint={(
            <span className="tabular-nums">
              {t('resourceLoadSummary')
                .replace('{rooms}', String(visibleRows.length))
                .replace('{lessons}', String(bookedEventCount))}
            </span>
          )}
          previousLabel={t('previousDay')}
          nextLabel={t('nextDay')}
          atToday={isToday}
          onPrevious={() => shiftDay(-1)}
          onNext={() => shiftDay(1)}
          onToday={goToday}
          actions={(
            <Input
              type="date"
              className="h-8 w-auto"
              aria-label={t('dateColumn')}
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          )}
        />
      </CardHeader>

      <CardContent className="p-0">
        {schedule.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : schedule.isError ? (
          <div className="p-5">
            <Alert variant="destructive">
              <AlertTitle>{t('failedToLoadData')}</AlertTitle>
              <AlertDescription>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => schedule.refetch()}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : visibleRows.length ? (
          <div className="max-h-[34rem] overflow-auto overscroll-contain">
            <div
              className="relative min-w-max"
              style={{ width: RESOURCE_COLUMN_WIDTH + timeScale.totalSize }}
            >
              <div className="sticky top-0 z-30 grid grid-cols-[13rem_minmax(0,1fr)] border-b border-border bg-muted/60 backdrop-blur-sm">
                <div className="sticky left-0 z-10 bg-muted/95 px-4 py-3 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                  {t('scheduleResources')}
                </div>
                <div className="relative min-h-11 border-l border-border">
                  {collapsedSegments.map((segment) => {
                    const start = formatCalendarMinutes(segment.startMinutes);
                    const end = formatCalendarMinutes(segment.endMinutes);
                    return (
                      <div
                        key={`${segment.startMinutes}-${segment.endMinutes}`}
                        className="absolute inset-y-0 flex items-center justify-center border-x border-dashed border-border bg-muted/80 px-1"
                        style={{ left: segment.offset, width: segment.size }}
                        role="note"
                        aria-label={t('collapsedScheduleGap')
                          .replace('{start}', start)
                          .replace('{end}', end)}
                      >
                        <span className="truncate text-[10px] font-medium tabular-nums text-muted-foreground">
                          {start}–{end}
                        </span>
                      </div>
                    );
                  })}
                  {timeScale.markers.map((marker) => (
                    <div
                      key={marker.minutes}
                      className="absolute inset-y-0 z-10 border-l border-border"
                      style={{ left: marker.offset }}
                    >
                      <span className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                        {formatCalendarMinutes(marker.minutes)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <TooltipProvider delayDuration={250}>
                {visibleRows.map((room) => {
                  const events = assignCalendarLanes(eventsByRoomId.get(room.id) ?? []);
                  const laneCount = events.reduce(
                    (maximum, event) => Math.max(maximum, event.lane + 1),
                    1,
                  );
                  const rowHeight = Math.max(72, laneCount * LANE_HEIGHT + ROW_PADDING * 2);

                  return (
                    <div
                      key={room.id}
                      className="grid grid-cols-[13rem_minmax(0,1fr)] border-b border-border last:border-b-0"
                      style={{ minHeight: rowHeight }}
                    >
                      <div className="sticky left-0 z-20 flex flex-col justify-center gap-1 border-r border-border bg-card px-4 py-3">
                        <span className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                          {room.isOnline ? <Wifi className="size-4 shrink-0" /> : <DoorOpen className="size-4 shrink-0" />}
                          <span className="truncate">{room.name}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {room.isOnline ? <Wifi className="size-3.5" /> : <UsersRound className="size-3.5" />}
                          {room.isOnline ? t('demoOnlineLocation') : `${room.capacity} ${t('students')}`}
                          {events.length > 0 ? (
                            <span className="ml-auto rounded-md bg-muted px-1.5 text-[10px] font-semibold tabular-nums">
                              {events.length}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="relative bg-card">
                        {collapsedSegments.map((segment) => (
                          <div
                            key={`${segment.startMinutes}-${segment.endMinutes}`}
                            className="absolute inset-y-0 border-x border-dashed border-border bg-muted/45"
                            style={{ left: segment.offset, width: segment.size }}
                            aria-hidden="true"
                          />
                        ))}
                        {timeScale.markers.map((marker) => (
                          <div
                            key={marker.minutes}
                            className="absolute inset-y-0 border-l border-border/70"
                            style={{ left: marker.offset }}
                            aria-hidden="true"
                          />
                        ))}
                        {events.map((event) => {
                          const left = getCalendarMinutePosition(timeScale, event.startMinutes);
                          const right = getCalendarMinutePosition(timeScale, event.endMinutes);
                          const width = Math.max(56, right - left - 6);
                          const tone = SOURCE_TONES[event.source];
                          const eventName = event.source === 'demo' ? t('demoLesson') : event.name;
                          const timeRange = `${formatCalendarMinutes(event.startMinutes)}–${formatCalendarMinutes(event.endMinutes)}`;

                          return (
                            <Tooltip key={event.id}>
                              <TooltipTrigger asChild>
                                <article
                                  tabIndex={0}
                                  className="absolute z-10 flex flex-col justify-center overflow-hidden rounded-md border px-2 py-1 text-left shadow-2xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  style={{
                                    left: left + 3,
                                    width,
                                    top: ROW_PADDING + event.lane * LANE_HEIGHT,
                                    height: LANE_HEIGHT - 6,
                                    backgroundColor: tone.background,
                                    borderColor: tone.border,
                                    color: tone.foreground,
                                    borderLeftWidth: 3,
                                    borderLeftColor: tone.solid,
                                  }}
                                  aria-label={`${timeRange}, ${eventName}`}
                                >
                                  <span className="truncate text-xs font-semibold leading-tight">
                                    {eventName}
                                  </span>
                                  <span className="truncate text-[10px] tabular-nums opacity-80">
                                    {timeRange} · {event.teacherName ?? t('notAssigned')}
                                  </span>
                                </article>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-60">
                                <p className="font-semibold">{eventName}</p>
                                <p className="text-xs opacity-80">
                                  {timeRange} · {event.courseName ?? t('noCourse')}
                                </p>
                                <p className="text-xs opacity-80">
                                  {event.teacherName ?? t('notAssigned')}
                                </p>
                                {event.source === 'demo' ? (
                                  <p className="text-xs opacity-80">
                                    {event.participantCount ?? 0} {t('demoParticipantsShort')}
                                  </p>
                                ) : null}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                        {events.length === 0 ? (
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                            {t('roomAvailable')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </TooltipProvider>

              {showCurrentTime ? (
                <div
                  className="pointer-events-none absolute inset-y-0 z-[15] w-px bg-destructive"
                  style={{ left: RESOURCE_COLUMN_WIDTH + getCalendarMinutePosition(timeScale, currentMinutes) }}
                  aria-hidden="true"
                >
                  <span className="absolute -left-1 top-0 size-2 rounded-full bg-destructive" />
                </div>
              ) : null}
            </div>
          </div>
        ) : resourceRows.length ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 p-6 text-center">
            <SearchX className="text-muted-foreground" />
            <p className="font-medium text-foreground">{t('noRoomsFound')}</p>
            <Button variant="outline" size="sm" onClick={() => setRoomSearch('')}>
              {t('reset')}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 p-6 text-center">
            <DoorOpen className="text-muted-foreground" />
            <p className="font-medium text-foreground">{t('noRooms')}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t('noRoomsDescription')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
