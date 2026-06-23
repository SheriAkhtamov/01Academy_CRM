import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, DoorOpen, UsersRound } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

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

interface ResourceRoom {
  id: number;
  name: string;
  capacity: number;
  groups: ResourceGroup[];
  lessons: ResourceLesson[];
}

interface ResourceScheduleResponse {
  date: string;
  rooms: ResourceRoom[];
}

interface CalendarEvent {
  id: string;
  source: 'group' | 'lesson';
  name: string;
  courseName?: string | null;
  teacherName?: string | null;
  startMinutes: number;
  endMinutes: number;
}

const START_HOUR = 9;
const END_HOUR = 21;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index);

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

  return [...recurring, ...lessons]
    .filter((event) => event.endMinutes > START_HOUR * 60 && event.startMinutes < END_HOUR * 60)
    .sort((left, right) => left.startMinutes - right.startMinutes || left.name.localeCompare(right.name));
};

export function AdminScheduleCalendar({ schools }: { schools: SchoolOption[] }) {
  const { t } = useTranslation();
  const activeSchools = useMemo(
    () => schools.filter((school) => school.isActive !== false),
    [schools],
  );
  const [schoolId, setSchoolId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));

  useEffect(() => {
    if (!schoolId && activeSchools[0]) setSchoolId(String(activeSchools[0].id));
  }, [activeSchools, schoolId]);

  const schedule = useQuery<ResourceScheduleResponse>({
    queryKey: ['/api/academy/schedule/resource', schoolId, selectedDate],
    queryFn: () => apiRequest(
      'GET',
      `/api/academy/schedule/resource?schoolId=${encodeURIComponent(schoolId)}&date=${encodeURIComponent(selectedDate)}`,
    ),
    enabled: Boolean(schoolId && selectedDate),
  });

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-4 border-b border-border md:flex-row md:items-end md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays data-icon="inline-start" />
            {t('resourceCalendar')}
          </CardTitle>
          <CardDescription>{t('resourceCalendarDescription')}</CardDescription>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:w-auto">
          <Select value={schoolId} onValueChange={setSchoolId}>
            <SelectTrigger aria-label={t('school')}><SelectValue placeholder={t('selectSchool')} /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {activeSchools.map((school) => (
                  <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            type="date"
            aria-label={t('dateColumn')}
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {schedule.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : schedule.data?.rooms.length ? (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[13rem_repeat(12,minmax(5rem,1fr))] border-b border-border bg-muted/40">
                <div className="px-4 py-3 text-xs font-medium text-muted-foreground">{t('rooms')}</div>
                {HOURS.map((hour) => (
                  <div key={hour} className="border-l border-border px-2 py-3 text-center text-xs font-medium tabular-nums text-muted-foreground">
                    {String(hour).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
              {schedule.data.rooms.map((room) => {
                const events = buildRoomEvents(room, selectedDate);
                return (
                  <div key={room.id} className="grid grid-cols-[13rem_minmax(0,1fr)] border-b border-border last:border-b-0">
                    <div className="flex flex-col justify-center gap-1 border-r border-border bg-card px-4 py-3">
                      <span className="flex items-center gap-2 font-medium text-foreground"><DoorOpen />{room.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground"><UsersRound />{room.capacity} {t('students')}</span>
                    </div>
                    <div className="relative min-h-24 bg-card">
                      <div className="absolute inset-0 grid grid-cols-12" aria-hidden="true">
                        {HOURS.map((hour) => <div key={hour} className="border-r border-border last:border-r-0" />)}
                      </div>
                      {events.map((event) => {
                        const visibleStart = Math.max(event.startMinutes, START_HOUR * 60);
                        const visibleEnd = Math.min(event.endMinutes, END_HOUR * 60);
                        const left = ((visibleStart - START_HOUR * 60) / ((END_HOUR - START_HOUR) * 60)) * 100;
                        const width = ((visibleEnd - visibleStart) / ((END_HOUR - START_HOUR) * 60)) * 100;
                        return (
                          <article
                            key={event.id}
                            className={cn(
                              'absolute top-3 z-10 flex h-[calc(100%-1.5rem)] min-w-16 flex-col justify-center rounded-md border px-2 py-1 text-left shadow-sm',
                              event.source === 'lesson'
                                ? 'border-amber-300 bg-amber-50 text-amber-950'
                                : 'border-primary/30 bg-primary/10 text-primary',
                            )}
                            style={{ left: `calc(${left}% + 3px)`, width: `calc(${width}% - 6px)` }}
                            title={`${event.name} · ${event.courseName ?? ''} · ${event.teacherName ?? ''}`}
                          >
                            <span className="truncate text-xs font-semibold">{event.name}</span>
                            <span className="truncate text-[11px] opacity-80">{event.courseName ?? '—'} · {event.teacherName ?? t('notAssigned')}</span>
                          </article>
                        );
                      })}
                      {events.length === 0 ? (
                        <span className="absolute inset-0 z-10 flex items-center justify-center text-xs text-muted-foreground">{t('roomAvailable')}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
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
