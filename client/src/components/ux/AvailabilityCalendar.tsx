import { useEffect, useMemo, useState } from 'react';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import {
  demoLessonsApi,
  type AvailabilityResponse,
  type AvailabilitySlot,
} from '@/features/demo-lessons/api';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserRoundCheck,
} from 'lucide-react';

interface AvailabilityCalendarProps {
  schoolId?: number | null;
  courseId?: number | null;
  value?: AvailabilitySlot | null;
  onChange: (value: AvailabilitySlot | null) => void;
  format?: 'offline' | 'online';
  participantCount?: number;
  participantIds?: number[];
  excludeLeadId?: number | null;
  className?: string;
}

const localDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

const PART_OF_DAY = [
  { key: 'morning', labelKey: 'partOfDayMorning', untilMinutes: 12 * 60 },
  { key: 'afternoon', labelKey: 'partOfDayAfternoon', untilMinutes: 17 * 60 },
  { key: 'evening', labelKey: 'partOfDayEvening', untilMinutes: 24 * 60 },
] satisfies ReadonlyArray<{ key: string; labelKey: TranslationKey; untilMinutes: number }>;

const slotMinutes = (slot: AvailabilitySlot) => {
  const startsAt = new Date(slot.startsAt);
  return startsAt.getHours() * 60 + startsAt.getMinutes();
};

export function AvailabilityCalendar({
  schoolId,
  courseId,
  value,
  onChange,
  format: demoFormat = 'offline',
  participantCount = 1,
  participantIds = [],
  excludeLeadId,
  className,
}: AvailabilityCalendarProps) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? ru : enUS;
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date()));
  const selectedValueDate = value ? new Date(value.startsAt) : null;
  const [selectedDateKey, setSelectedDateKey] = useState(() =>
    selectedValueDate && !Number.isNaN(selectedValueDate.getTime())
      ? localDateKey(selectedValueDate)
      : localDateKey(new Date())
  );
  const [teacherFilter, setTeacherFilter] = useState<number | null>(null);
  const from = localDateKey(weekStart);

  const availability = useQuery<AvailabilityResponse>({
    queryKey: ['/api/academy/availability/slots', schoolId, courseId, from, demoFormat, participantCount, participantIds.join(','), excludeLeadId],
    queryFn: () => demoLessonsApi.availability({
      schoolId: Number(schoolId),
      courseId: Number(courseId),
      from,
      days: 7,
      format: demoFormat,
      participantCount,
      participantIds,
      excludeLeadId,
    }),
    enabled: Boolean(schoolId && courseId),
  });

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, AvailabilitySlot[]>();
    for (const slot of availability.data?.slots ?? []) {
      const key = localDateKey(new Date(slot.startsAt));
      const existing = grouped.get(key) ?? [];
      existing.push(slot);
      grouped.set(key, existing);
    }
    return grouped;
  }, [availability.data?.slots]);
  const daySlots = useMemo(
    () => slotsByDay.get(selectedDateKey) ?? [],
    [selectedDateKey, slotsByDay],
  );
  const teachers = useMemo(() => {
    const byId = new Map<number, string>();
    for (const slot of availability.data?.slots ?? []) {
      if (slot.teacherId) byId.set(Number(slot.teacherId), slot.teacherName);
    }
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [availability.data?.slots]);
  const selectedSlots = useMemo(
    () => (teacherFilter
      ? daySlots.filter((slot) => Number(slot.teacherId) === teacherFilter)
      : daySlots),
    [daySlots, teacherFilter],
  );
  const maxDaySlots = useMemo(
    () => Math.max(1, ...[...slotsByDay.values()].map((slots) => slots.length)),
    [slotsByDay],
  );
  const groupedSlots = useMemo(() => {
    const sorted = [...selectedSlots].sort((left, right) => slotMinutes(left) - slotMinutes(right));
    return PART_OF_DAY
      .map((part, index) => {
        const fromMinutes = index === 0 ? 0 : PART_OF_DAY[index - 1].untilMinutes;
        return {
          ...part,
          slots: sorted.filter((slot) => {
            const minutes = slotMinutes(slot);
            return minutes >= fromMinutes && minutes < part.untilMinutes;
          }),
        };
      })
      .filter((part) => part.slots.length > 0);
  }, [selectedSlots]);

  useEffect(() => {
    if (value) {
      const date = new Date(value.startsAt);
      if (!Number.isNaN(date.getTime())) {
        setSelectedDateKey(localDateKey(date));
        const currentWeekEnd = addDays(weekStart, 7);
        if (date < weekStart || date >= currentWeekEnd) setWeekStart(startOfDay(date));
      }
    }
  }, [value, weekStart]);

  useEffect(() => {
    if (slotsByDay.has(selectedDateKey)) return;
    const firstAvailableDay = days.find((day) => (slotsByDay.get(localDateKey(day))?.length ?? 0) > 0);
    if (firstAvailableDay) setSelectedDateKey(localDateKey(firstAvailableDay));
  }, [days, selectedDateKey, slotsByDay]);

  useEffect(() => {
    if (teacherFilter && !teachers.some((teacher) => teacher.id === teacherFilter)) {
      setTeacherFilter(null);
    }
  }, [teacherFilter, teachers]);

  if (!schoolId || !courseId) {
    return (
      <div className={cn('flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-center', className)}>
        <CalendarDays className="text-muted-foreground" />
        <p className="text-sm font-medium">{t('selectSchoolAndCourseForSlots')}</p>
        <p className="max-w-md text-xs text-muted-foreground">{t('slotCalendarHint')}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-border p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t('availableSlots')}</p>
          <p className="truncate text-xs text-muted-foreground">
            {availability.data
              ? `${t('resourceConflictRule')} · ${availability.data.durationMinutes} ${t('minuteShort')}`
              : t('checkingAvailability')}
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-md"
            aria-label={t('previousWeek')}
            disabled={localDateKey(weekStart) === localDateKey(new Date())}
            onClick={() => setWeekStart((current) => {
              const previous = addDays(current, -7);
              return previous < startOfDay(new Date()) ? startOfDay(new Date()) : previous;
            })}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center text-xs font-medium tabular-nums text-muted-foreground">
            {format(days[0], 'd MMM', { locale })} — {format(days[6], 'd MMM', { locale })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-md"
            aria-label={t('nextWeek')}
            onClick={() => setWeekStart((current) => addDays(current, 7))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {availability.isLoading ? (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
          {days.map((day) => <Skeleton key={day.toISOString()} className="h-14 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
          {days.map((day) => {
            const key = localDateKey(day);
            const count = slotsByDay.get(key)?.length ?? 0;
            const selected = key === selectedDateKey;
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={key}
                type="button"
                disabled={count === 0}
                aria-pressed={selected}
                aria-label={`${format(day, 'EEEE, d MMMM', { locale })}: ${count > 0 ? `${count} ${t('slotsShort')}` : t('noSlotsShort')}`}
                onClick={() => setSelectedDateKey(key)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                <span className="text-[10px] font-medium uppercase opacity-80">
                  {format(day, 'EEEEEE', { locale })}
                </span>
                <span className={cn(
                  'text-sm font-semibold tabular-nums',
                  isToday && !selected && 'text-primary',
                )}>
                  {format(day, 'd')}
                </span>
                <span
                  className={cn(
                    'h-1 w-full rounded-full',
                    selected ? 'bg-primary-foreground/40' : 'bg-muted',
                  )}
                  aria-hidden="true"
                >
                  <span
                    className={cn(
                      'block h-1 rounded-full',
                      count === 0
                        ? 'bg-transparent'
                        : selected ? 'bg-primary-foreground' : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.round((count / maxDaySlots) * 100)}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {availability.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-muted p-5 text-center">
          <p className="text-sm text-muted-foreground">{t('slotsLoadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => availability.refetch()}>
            <RefreshCw data-icon="inline-start" />
            {t('retry')}
          </Button>
        </div>
      ) : null}

      {!availability.isError && teachers.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={teacherFilter === null}
            onClick={() => setTeacherFilter(null)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              teacherFilter === null
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            {t('allTeachers')}
          </button>
          {teachers.map((teacher) => (
            <button
              key={teacher.id}
              type="button"
              aria-pressed={teacherFilter === teacher.id}
              onClick={() => setTeacherFilter(teacher.id)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                teacherFilter === teacher.id
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent',
              )}
            >
              {teacher.name}
            </button>
          ))}
        </div>
      ) : null}

      {availability.isLoading ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : !availability.isError ? (
        groupedSlots.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {groupedSlots.map((part) => (
              <div key={part.key} className="flex flex-col gap-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(part.labelKey)}
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                  {part.slots.map((slot) => {
                    const selected = value
                      ? new Date(value.startsAt).getTime() === new Date(slot.startsAt).getTime()
                        && Number(value.teacherId) === Number(slot.teacherId)
                        && Number(value.roomId ?? 0) === Number(slot.roomId ?? 0)
                      : false;
                    return (
                      <button
                        key={`${slot.startsAt}-${slot.teacherId}-${slot.roomId ?? 0}`}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(slot)}
                        className={cn(
                          'flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card hover:border-border-strong hover:bg-accent',
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5">
                          <span className="text-sm font-semibold tabular-nums">
                            {format(new Date(slot.startsAt), 'HH:mm')}
                          </span>
                          <span className="text-[10px] tabular-nums opacity-70">
                            –{format(new Date(slot.endsAt), 'HH:mm')}
                          </span>
                          {selected ? <Check className="ml-auto size-3.5" aria-hidden="true" /> : null}
                        </span>
                        <span className={cn('w-full truncate text-[10px]', selected ? 'opacity-80' : 'text-muted-foreground')}>
                          {slot.teacherName}
                        </span>
                        <span className={cn('w-full truncate text-[10px]', selected ? 'opacity-80' : 'text-muted-foreground')}>
                          {demoFormat === 'online' ? t('online') : slot.roomName ?? t('roomNotFound')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-lg bg-muted/60 p-4 text-center">
            <UserRoundCheck className="text-muted-foreground" />
            <p className="text-sm font-medium">{t('noAvailableSlotsForDay')}</p>
            <p className="text-xs text-muted-foreground">{t('chooseAnotherDayOrWeek')}</p>
          </div>
        )
      ) : null}

      {value ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          <Badge variant="default">
            <Check data-icon="inline-start" />
            {format(new Date(value.startsAt), 'd MMMM, HH:mm', { locale })}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">{value.teacherName}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => onChange(null)}
          >
            {t('clearSelection')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
