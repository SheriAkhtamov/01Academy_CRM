import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

export type AttendanceCalendarLesson = {
  id: number;
  groupName?: string;
  topic: string;
  scheduledAt: string;
  status: string;
};

interface AttendanceCalendarProps {
  lessons: AttendanceCalendarLesson[];
  selectedLessonId: string;
  now: number;
  disabled?: boolean;
  onSelectLesson: (lessonId: string) => void;
}

const ACADEMY_TIME_ZONE = 'Asia/Tashkent';
const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACADEMY_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const academyDateKey = (value: string | Date) => {
  const parts: Record<string, string> = {};
  for (const part of dateKeyFormatter.formatToParts(new Date(value))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const monthKeyFromInstant = (value: Date) => academyDateKey(value).slice(0, 7);

const shiftMonthKey = (monthKey: string, offset: number) => {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
};

const buildMonthDays = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const leadingDays = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - leadingDays + 1));
    const dateKey = [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
    return {
      date,
      dateKey,
      isCurrentMonth: dateKey.startsWith(monthKey),
    };
  });
};

const lessonTone = (lesson: AttendanceCalendarLesson, now: number) => {
  if (lesson.status === 'conducted') return 'conducted';
  return new Date(lesson.scheduledAt).getTime() <= now ? 'pending' : 'upcoming';
};

const toneClasses = {
  pending: 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100',
  conducted: 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100',
  upcoming: 'border-blue-300 bg-blue-50 text-blue-950 hover:bg-blue-100',
} as const;

export function AttendanceCalendar({
  lessons,
  selectedLessonId,
  now,
  disabled = false,
  onSelectLesson,
}: AttendanceCalendarProps) {
  const { t, language } = useTranslation();
  const [monthKey, setMonthKey] = useState(() => monthKeyFromInstant(new Date(now)));
  const calendarDays = useMemo(() => buildMonthDays(monthKey), [monthKey]);
  const todayKey = academyDateKey(new Date(now));
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const [year, month] = monthKey.split('-').map(Number);
  const monthLabel = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 15))), [locale, month, year]);
  const dayNames = [
    t('mondayShort'),
    t('tuesdayShort'),
    t('wednesdayShort'),
    t('thursdayShort'),
    t('fridayShort'),
    t('saturdayShort'),
    t('sundayShort'),
  ];

  const lessonsByDate = useMemo(() => {
    const result = new Map<string, AttendanceCalendarLesson[]>();
    for (const lesson of lessons) {
      const dateKey = academyDateKey(lesson.scheduledAt);
      const dayLessons = result.get(dateKey) ?? [];
      dayLessons.push(lesson);
      result.set(dateKey, dayLessons);
    }
    for (const dayLessons of result.values()) {
      dayLessons.sort(
        (left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
      );
    }
    return result;
  }, [lessons]);

  const monthLessons = useMemo(
    () => lessons.filter((lesson) => academyDateKey(lesson.scheduledAt).startsWith(monthKey)),
    [lessons, monthKey],
  );
  const counts = useMemo(() => monthLessons.reduce(
    (result, lesson) => {
      result[lessonTone(lesson, now)] += 1;
      return result;
    },
    { pending: 0, conducted: 0, upcoming: 0 },
  ), [monthLessons, now]);

  const selectLesson = (lessonId: number) => {
    if (!disabled) onSelectLesson(String(lessonId));
  };

  const lessonButton = (lesson: AttendanceCalendarLesson, compact = false) => {
    const tone = lessonTone(lesson, now);
    const isSelected = String(lesson.id) === selectedLessonId;
    const time = new Date(lesson.scheduledAt).toLocaleTimeString(locale, {
      timeZone: ACADEMY_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      <button
        key={lesson.id}
        type="button"
        data-testid={`attendance-calendar-lesson-${lesson.id}`}
        disabled={disabled}
        aria-pressed={isSelected}
        onClick={() => selectLesson(lesson.id)}
        className={cn(
          'w-full rounded-md border-l-[3px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          compact ? 'px-3 py-2.5' : 'px-2 py-1.5',
          toneClasses[tone],
          isSelected && 'ring-2 ring-primary ring-offset-1',
        )}
      >
        <span className="flex items-center gap-1 text-[11px] font-semibold tabular-nums">
          <Clock3 className="size-3" />
          {time}
        </span>
        <span className={cn('block font-medium', compact ? 'mt-1 text-sm' : 'truncate text-xs')}>
          {lesson.topic}
        </span>
        <span className={cn('block opacity-70', compact ? 'mt-0.5 text-xs' : 'truncate text-[10px]')}>
          {lesson.groupName || t('noGroup')}
        </span>
      </button>
    );
  };

  return (
    <Card className="border-border/70 overflow-hidden">
      <CardHeader className="gap-4 border-b border-border/70 bg-muted/20 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-5 text-primary" />
              {t('attendanceCalendarTitle')}
            </CardTitle>
            <CardDescription className="mt-1">{t('attendanceCalendarHint')}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5 self-start rounded-lg border bg-background p-1 lg:self-auto">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('previousMonth')}
              onClick={() => setMonthKey((current) => shiftMonthKey(current, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setMonthKey(monthKeyFromInstant(new Date(now)))}
            >
              {t('today')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('nextMonth')}
              onClick={() => setMonthKey((current) => shiftMonthKey(current, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold capitalize text-foreground">{monthLabel}</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500" />
              {t('attendanceNeedsAction')}: {counts.pending}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-blue-500" />
              {t('upcomingLessons')}: {counts.upcoming}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              {t('completedLessons')}: {counts.conducted}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="hidden overflow-x-auto md:block">
          <div className="min-w-[840px]">
            <div className="grid grid-cols-7 border-b bg-muted/30">
              {dayNames.map((dayName) => (
                <div key={dayName} className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">
                  {dayName}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calendarDays.map((day) => {
                const dayLessons = lessonsByDate.get(day.dateKey) ?? [];
                return (
                  <div
                    key={day.dateKey}
                    className={cn(
                      'min-h-32 border-b border-r border-border/70 p-2',
                      !day.isCurrentMonth && 'bg-muted/20 text-muted-foreground',
                      day.dateKey === todayKey && 'bg-primary/[0.035]',
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                          day.dateKey === todayKey && 'bg-primary text-primary-foreground',
                        )}
                      >
                        {day.date.getUTCDate()}
                      </span>
                      {dayLessons.some((lesson) => lesson.status === 'conducted') ? (
                        <CircleCheck className="size-3.5 text-emerald-500" />
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      {dayLessons.map((lesson) => lessonButton(lesson))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="divide-y md:hidden">
          {calendarDays.flatMap((day) => {
            if (!day.isCurrentMonth) return [];
            const dayLessons = lessonsByDate.get(day.dateKey) ?? [];
            if (dayLessons.length === 0) return [];
            const dateLabel = new Intl.DateTimeFormat(locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            }).format(day.date);
            return [(
              <section key={day.dateKey} className="space-y-2.5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold capitalize">{dateLabel}</h4>
                  <span className="text-xs text-muted-foreground">
                    {dayLessons.length} {t('lessonsCount').toLowerCase()}
                  </span>
                </div>
                <div className="space-y-2">
                  {dayLessons.map((lesson) => lessonButton(lesson, true))}
                </div>
              </section>
            )];
          })}
        </div>

        {monthLessons.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CalendarDays className="mx-auto size-9 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">{t('noLessonsThisMonth')}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
