import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  UserRoundCheck,
} from 'lucide-react';

interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
  teacherId: number;
  teacherName: string;
  availableTeacherCount: number;
}

interface AvailabilityResponse {
  durationMinutes: number;
  slots: AvailabilitySlot[];
}

interface AvailabilityCalendarProps {
  schoolId?: number | null;
  courseId?: number | null;
  value?: string;
  onChange: (value: string) => void;
  excludeLeadId?: number | null;
  className?: string;
}

const localDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

export function AvailabilityCalendar({
  schoolId,
  courseId,
  value,
  onChange,
  excludeLeadId,
  className,
}: AvailabilityCalendarProps) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? ru : enUS;
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date()));
  const selectedValueDate = value ? new Date(value) : null;
  const [selectedDateKey, setSelectedDateKey] = useState(() =>
    selectedValueDate && !Number.isNaN(selectedValueDate.getTime())
      ? localDateKey(selectedValueDate)
      : localDateKey(new Date())
  );
  const from = localDateKey(weekStart);

  const availability = useQuery<AvailabilityResponse>({
    queryKey: ['/api/academy/availability/slots', schoolId, courseId, from, excludeLeadId],
    queryFn: () => {
      const params = new URLSearchParams({
        schoolId: String(schoolId),
        courseId: String(courseId),
        from,
        days: '7',
      });
      if (excludeLeadId) params.set('excludeLeadId', String(excludeLeadId));
      return apiRequest('GET', `/api/academy/availability/slots?${params.toString()}`);
    },
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
  const selectedSlots = slotsByDay.get(selectedDateKey) ?? [];

  useEffect(() => {
    if (value) {
      const date = new Date(value);
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

  if (!schoolId || !courseId) {
    return (
      <div className={cn('flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-center', className)}>
        <CalendarDays className="text-muted-foreground" />
        <p className="text-sm font-medium">{t('selectSchoolAndCourseForSlots')}</p>
        <p className="max-w-md text-xs text-muted-foreground">{t('slotCalendarHint')}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4 rounded-xl border border-border p-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">{t('availableSlots')}</p>
          <p className="text-xs text-muted-foreground">
            {availability.data
              ? `${t('singleRoomRule')} · ${availability.data.durationMinutes} ${t('minuteShort')}`
              : t('checkingAvailability')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={localDateKey(weekStart) === localDateKey(new Date())}
            onClick={() => setWeekStart((current) => {
              const previous = addDays(current, -7);
              return previous < startOfDay(new Date()) ? startOfDay(new Date()) : previous;
            })}
          >
            <ChevronLeft />
            <span className="sr-only">{t('previousWeek')}</span>
          </Button>
          <span className="min-w-32 text-center text-xs font-medium text-muted-foreground">
            {format(days[0], 'd MMM', { locale })} — {format(days[6], 'd MMM', { locale })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setWeekStart((current) => addDays(current, 7))}
          >
            <ChevronRight />
            <span className="sr-only">{t('nextWeek')}</span>
          </Button>
        </div>
      </div>

      {availability.isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((day) => <Skeleton key={day.toISOString()} className="h-16 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((day) => {
            const key = localDateKey(day);
            const count = slotsByDay.get(key)?.length ?? 0;
            const selected = key === selectedDateKey;
            return (
              <Button
                key={key}
                type="button"
                variant={selected ? 'default' : 'outline'}
                className="h-auto min-h-16 flex-col gap-1 px-2 py-2"
                aria-pressed={selected}
                onClick={() => setSelectedDateKey(key)}
              >
                <span className="text-[11px] font-medium uppercase">
                  {format(day, 'EEE', { locale })}
                </span>
                <span className="text-sm font-semibold">{format(day, 'd MMM', { locale })}</span>
                <span className={cn('text-[10px]', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {count > 0 ? `${count} ${t('slotsShort')}` : t('noSlotsShort')}
                </span>
              </Button>
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

      {!availability.isLoading && !availability.isError ? (
        selectedSlots.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {selectedSlots.map((slot) => {
              const selected = value
                ? new Date(value).getTime() === new Date(slot.startsAt).getTime()
                : false;
              return (
                <Button
                  key={slot.startsAt}
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  className="h-auto justify-start gap-3 px-3 py-3"
                  onClick={() => onChange(slot.startsAt)}
                >
                  <Clock3 />
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="font-semibold">
                      {format(new Date(slot.startsAt), 'HH:mm')}–{format(new Date(slot.endsAt), 'HH:mm')}
                    </span>
                    <span className={cn('truncate text-[10px]', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                      {slot.availableTeacherCount} {t('teachersAvailableShort')}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg bg-muted/60 p-5 text-center">
            <UserRoundCheck className="text-muted-foreground" />
            <p className="text-sm font-medium">{t('noAvailableSlotsForDay')}</p>
            <p className="text-xs text-muted-foreground">{t('chooseAnotherDayOrWeek')}</p>
          </div>
        )
      ) : null}

      {value ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <CalendarDays data-icon="inline-start" />
            {format(new Date(value), 'd MMMM, HH:mm', { locale })}
          </Badge>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            {t('clearSelection')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
