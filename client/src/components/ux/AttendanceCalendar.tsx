import { useMemo, useRef, useState } from 'react';
import { CalendarDays, CircleCheck, Clock3, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarNavigator } from '@/components/ux/calendar/CalendarNavigator';
import { CALENDAR_TONES } from '@/components/ux/calendar/calendarTones';
import { useCalendarPreference } from '@/hooks/useCalendarPreference';
import { useCalendarShortcuts } from '@/hooks/useCalendarShortcuts';
import { useIsCompactViewport } from '@/hooks/useMediaQuery';
import { useTranslation } from '@/hooks/useTranslation';
import type { CalendarViewMode } from '@/lib/calendarPreferences';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';

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

type AttendanceState = 'pending' | 'upcoming' | 'conducted';

const VIEWS = ['month', 'week', 'agenda'] as const satisfies readonly CalendarViewMode[];
const VISIBLE_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATE_TONES = {
  pending: CALENDAR_TONES[2],
  upcoming: CALENDAR_TONES[0],
  conducted: CALENDAR_TONES[1],
} as const;

const STATE_LABEL_KEYS = {
  pending: 'attendanceNeedsAction',
  upcoming: 'upcomingLessons',
  conducted: 'completedLessons',
} satisfies Record<AttendanceState, TranslationKey>;

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

/* Day arithmetic runs in UTC so that a academy-local date key never drifts
   across a daylight-saving boundary in the browser's own zone. */
const dateFromKey = (key: string) => new Date(`${key}T00:00:00Z`);
const keyFromDate = (date: Date) => date.toISOString().slice(0, 10);
const shiftDayKey = (key: string, days: number) => (
  keyFromDate(new Date(dateFromKey(key).getTime() + days * DAY_MS))
);
const weekStartKey = (key: string) => (
  shiftDayKey(key, -((dateFromKey(key).getUTCDay() + 6) % 7))
);
const shiftMonthKey = (key: string, offset: number) => {
  const date = dateFromKey(key);
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
  return keyFromDate(shifted);
};

const buildMonthDays = (anchorKey: string) => {
  const anchor = dateFromKey(anchorKey);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const leadingDays = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - leadingDays + 1));
    return {
      date,
      dateKey: keyFromDate(date),
      isCurrentMonth: date.getUTCMonth() === month,
    };
  });
};

const buildWeekDays = (anchorKey: string) => {
  const start = weekStartKey(anchorKey);
  return Array.from({ length: 7 }, (_, index) => {
    const dateKey = shiftDayKey(start, index);
    return { date: dateFromKey(dateKey), dateKey, isCurrentMonth: true };
  });
};

const lessonState = (lesson: AttendanceCalendarLesson, now: number): AttendanceState => {
  if (lesson.status === 'conducted') return 'conducted';
  return new Date(lesson.scheduledAt).getTime() <= now ? 'pending' : 'upcoming';
};

export function AttendanceCalendar({
  lessons,
  selectedLessonId,
  now,
  disabled = false,
  onSelectLesson,
}: AttendanceCalendarProps) {
  const { t, language } = useTranslation();
  const isCompactViewport = useIsCompactViewport();
  const [view, setView] = useCalendarPreference<CalendarViewMode>(
    'attendanceCalendarView',
    VIEWS,
    isCompactViewport ? 'agenda' : 'month',
  );
  const todayKey = academyDateKey(new Date(now));
  const [anchorKey, setAnchorKey] = useState(todayKey);
  const [hiddenStates, setHiddenStates] = useState<Set<AttendanceState>>(() => new Set());
  const scopeRef = useRef<HTMLDivElement>(null);
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';

  const calendarDays = useMemo(
    () => (view === 'month' ? buildMonthDays(anchorKey) : buildWeekDays(anchorKey)),
    [anchorKey, view],
  );
  const rangeKeys = useMemo(
    () => new Set(calendarDays.filter((day) => day.isCurrentMonth).map((day) => day.dateKey)),
    [calendarDays],
  );

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

  const rangeLessons = useMemo(
    () => lessons.filter((lesson) => rangeKeys.has(academyDateKey(lesson.scheduledAt))),
    [lessons, rangeKeys],
  );
  const counts = useMemo(() => rangeLessons.reduce(
    (result, lesson) => {
      result[lessonState(lesson, now)] += 1;
      return result;
    },
    { pending: 0, upcoming: 0, conducted: 0 },
  ), [rangeLessons, now]);
  const visibleLessonsFor = (dateKey: string) => (
    (lessonsByDate.get(dateKey) ?? [])
      .filter((lesson) => !hiddenStates.has(lessonState(lesson, now)))
  );
  const visibleRangeCount = useMemo(
    () => rangeLessons.filter((lesson) => !hiddenStates.has(lessonState(lesson, now))).length,
    [hiddenStates, now, rangeLessons],
  );

  // Oldest first: unmarked attendance is a backlog, and the lesson that has
  // been waiting longest is the one blocking the teacher's statistics.
  const nextPending = useMemo(() => (
    [...lessons]
      .filter((lesson) => lessonState(lesson, now) === 'pending')
      .sort((left, right) => (
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      ))[0] ?? null
  ), [lessons, now]);

  const shift = (direction: number) => {
    setAnchorKey((current) => (
      view === 'month'
        ? shiftMonthKey(current, direction)
        : shiftDayKey(current, direction * 7)
    ));
  };
  const goToday = () => setAnchorKey(todayKey);

  useCalendarShortcuts({
    onPrevious: () => shift(-1),
    onNext: () => shift(1),
    onToday: goToday,
    scopeRef,
  });

  const anchorDate = dateFromKey(anchorKey);
  const rangeLabel = view === 'month'
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(anchorDate)
    : `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(calendarDays[0].date)} — ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(calendarDays[calendarDays.length - 1].date)}`;
  const atToday = view === 'month'
    ? anchorKey.slice(0, 7) === todayKey.slice(0, 7)
    : weekStartKey(anchorKey) === weekStartKey(todayKey);

  const dayNames = [
    t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort'),
  ];

  const toggleState = (state: AttendanceState) => {
    setHiddenStates((current) => {
      const next = new Set(current);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  };

  const selectLesson = (lessonId: number) => {
    if (!disabled) onSelectLesson(String(lessonId));
  };

  const jumpToPending = () => {
    if (!nextPending) return;
    const key = academyDateKey(nextPending.scheduledAt);
    setAnchorKey(key);
    setHiddenStates(new Set());
    selectLesson(nextPending.id);
  };

  const lessonButton = (lesson: AttendanceCalendarLesson, roomy = false) => {
    const state = lessonState(lesson, now);
    const tone = STATE_TONES[state];
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
        aria-label={`${time}, ${lesson.topic}. ${t(STATE_LABEL_KEYS[state])}`}
        onClick={() => selectLesson(lesson.id)}
        className={cn(
          // Lesson chips are packed tightly into day cells, so the hover cue
          // is a small scale-up rather than a lift — a translate would make a
          // chip overlap the one below it.
          'w-full rounded-md border border-l-[3px] text-left transition-[box-shadow,transform] duration-150 ease-out',
          'hover:scale-[1.02] hover:shadow-md active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
          roomy ? 'px-3 py-2.5' : 'px-1.5 py-1',
          isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        )}
        style={{
          backgroundColor: tone.background,
          borderColor: tone.border,
          borderLeftColor: tone.solid,
          color: tone.foreground,
        }}
      >
        <span className="flex items-center gap-1 text-[10px] font-semibold tabular-nums opacity-90">
          <Clock3 className="size-3" aria-hidden="true" />
          {time}
        </span>
        <span className={cn('block truncate font-medium', roomy ? 'mt-1 text-sm' : 'text-[11px]')}>
          {lesson.topic}
        </span>
        <span className={cn('block truncate opacity-75', roomy ? 'mt-0.5 text-xs' : 'text-[10px]')}>
          {lesson.groupName || t('noGroup')}
        </span>
      </button>
    );
  };

  return (
    <Card className="overflow-hidden border-border/70" ref={scopeRef}>
      <CardHeader className="gap-3 border-b border-border/70 bg-muted/20 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-5 text-primary" />
              {t('attendanceCalendarTitle')}
            </CardTitle>
            <CardDescription className="mt-1">{t('attendanceCalendarHint')}</CardDescription>
          </div>
          {nextPending ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={disabled}
              onClick={jumpToPending}
            >
              <ListChecks />
              {t('jumpToNextAttendance')}
            </Button>
          ) : null}
        </div>

        <CalendarNavigator
          label={rangeLabel}
          previousLabel={view === 'month' ? t('previousMonth') : t('previousWeek')}
          nextLabel={view === 'month' ? t('nextMonth') : t('nextWeek')}
          atToday={atToday}
          onPrevious={() => shift(-1)}
          onNext={() => shift(1)}
          onToday={goToday}
          views={VIEWS}
          view={view}
          onViewChange={setView}
        />

        <div className="flex flex-wrap gap-1.5">
          {(['pending', 'upcoming', 'conducted'] as const).map((state) => {
            const active = !hiddenStates.has(state);
            return (
              <button
                key={state}
                type="button"
                data-testid={`attendance-filter-${state}`}
                aria-pressed={active}
                onClick={() => toggleState(state)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-border bg-card text-foreground'
                    : 'border-dashed border-border bg-transparent text-muted-foreground line-through',
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: STATE_TONES[state].solid }}
                  aria-hidden="true"
                />
                {t(STATE_LABEL_KEYS[state])}
                <span className="tabular-nums opacity-70">{counts[state]}</span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {visibleRangeCount === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <CalendarDays className="size-9 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t('noLessonsInRange')}</p>
          </div>
        ) : view === 'agenda' ? (
          <div className="max-h-[32rem] divide-y divide-border/60 overflow-auto overscroll-contain">
            {calendarDays.map((day) => {
              const dayLessons = visibleLessonsFor(day.dateKey);
              if (dayLessons.length === 0) return null;
              const dateLabel = new Intl.DateTimeFormat(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: 'UTC',
              }).format(day.date);

              return (
                <section key={day.dateKey} className="space-y-2 p-4 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className={cn(
                      'text-sm font-semibold capitalize',
                      day.dateKey === todayKey && 'text-primary',
                    )}>
                      {dateLabel}
                    </h4>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {dayLessons.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {dayLessons.map((lesson) => lessonButton(lesson, true))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className={cn(view === 'month' ? 'min-w-[760px]' : 'min-w-[640px]')}>
              <div className="grid grid-cols-7 border-b bg-muted/30">
                {dayNames.map((dayName) => (
                  <div
                    key={dayName}
                    className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {dayName}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const dayLessons = visibleLessonsFor(day.dateKey);
                  const shown = view === 'month'
                    ? dayLessons.slice(0, VISIBLE_PER_DAY)
                    : dayLessons;
                  const overflow = dayLessons.length - shown.length;
                  const isToday = day.dateKey === todayKey;

                  return (
                    <div
                      key={day.dateKey}
                      className={cn(
                        'flex flex-col gap-1 border-b border-r border-border/70 p-1.5 [&:nth-child(7n)]:border-r-0',
                        view === 'month' ? 'min-h-28' : 'min-h-40',
                        !day.isCurrentMonth && 'bg-muted/20 text-muted-foreground',
                        isToday && 'bg-primary/[0.05]',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'inline-flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                            isToday && 'bg-primary text-primary-foreground',
                          )}
                        >
                          {day.date.getUTCDate()}
                        </span>
                        {dayLessons.some((lesson) => lesson.status === 'conducted') ? (
                          <CircleCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-1">
                        {shown.map((lesson) => lessonButton(lesson))}
                        {overflow > 0 ? (
                          <button
                            type="button"
                            className="rounded px-1 py-0.5 text-left text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => {
                              setAnchorKey(day.dateKey);
                              setView('week');
                            }}
                          >
                            {t('moreEventsCount').replace('{count}', String(overflow))}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
