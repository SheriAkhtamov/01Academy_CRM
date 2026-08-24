import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CalendarDays, CircleCheck, Clock3, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarNavigator } from '@/components/ux/calendar/CalendarNavigator';
import { CALENDAR_TONES } from '@/components/ux/calendar/calendarTones';
import {
  buildMonthDays,
  buildWeekDays,
  dateFromDayKey,
  shiftDayKey,
  shiftMonthKey,
  weekStartDayKey,
} from '@/lib/calendarDays';
import { EmptyState } from '@/components/ux/EmptyState';
import { useCalendarPreference } from '@/hooks/useCalendarPreference';
import { useCalendarShortcuts } from '@/hooks/useCalendarShortcuts';
import { useIsCompactViewport } from '@/hooks/useMediaQuery';
import { useTranslation } from '@/hooks/useTranslation';
import type { CalendarViewMode } from '@/lib/calendarPreferences';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ACADEMY_TIME_ZONE, resolveLocale } from '@/lib/localeFormat';

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
const COMPACT_VIEWS = ['agenda'] as const satisfies readonly CalendarViewMode[];
const VISIBLE_PER_DAY = 3;

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
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const locale = resolveLocale(language);

  /* A grid 760px wide inside a 375px viewport is a horizontal scroller nested
     in a vertical one — the two fight on every touch drag. The stored
     preference is left alone; only what gets painted changes. */
  const effectiveView: CalendarViewMode = isCompactViewport && view !== 'agenda' ? 'agenda' : view;

  const calendarDays = useMemo(
    () => (effectiveView === 'month' ? buildMonthDays(anchorKey) : buildWeekDays(anchorKey)),
    [anchorKey, effectiveView],
  );
  /* Trailing cells of the neighbouring month paint their lessons, so they have
     to be counted too — otherwise the filter badges disagree with the screen,
     and a month whose only lessons sit in those cells reports itself empty. */
  const rangeKeys = useMemo(
    () => new Set(calendarDays.map((day) => day.dateKey)),
    [calendarDays],
  );

  useEffect(() => {
    setExpandedDayKey(null);
  }, [anchorKey, effectiveView]);

  const toggleExpandedDay = (dateKey: string) => {
    const willExpand = expandedDayKey !== dateKey;
    setExpandedDayKey(willExpand ? dateKey : null);
    if (!willExpand || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      document.getElementById(`attendance-day-${dateKey}`)?.scrollIntoView({ block: 'nearest' });
    });
  };

  /* The lesson can arrive from outside the calendar — a `?lesson=` link, the
     "attendance" button on a lesson three weeks back in the schedule, the
     overview CTA that opens the oldest unmarked lesson. Without this the modal
     was correct while the grid behind it still showed the current month, so
     closing the modal dropped the teacher somewhere they never navigated to. */
  const focusedLesson = useMemo(
    () => lessons.find((item) => String(item.id) === selectedLessonId) ?? null,
    [lessons, selectedLessonId],
  );
  const focusedLessonDateKey = focusedLesson ? academyDateKey(focusedLesson.scheduledAt) : null;
  const focusedLessonState = focusedLesson ? lessonState(focusedLesson, now) : null;

  useEffect(() => {
    if (!focusedLessonDateKey) return;
    setAnchorKey(focusedLessonDateKey);
  }, [focusedLessonDateKey]);

  useEffect(() => {
    if (!focusedLessonState) return;
    // Showing the lesson the user asked for outranks a filter they set earlier:
    // landing on a grid that hides the very lesson just opened reads as a bug.
    // Only the one state standing in the way is released, though — wiping every
    // filter would punish a teacher who narrowed the month down on purpose and
    // then opened a lesson that was visible all along.
    setHiddenStates((current) => {
      if (!current.has(focusedLessonState)) return current;
      const next = new Set(current);
      next.delete(focusedLessonState);
      return next;
    });
  }, [focusedLessonDateKey, focusedLessonState]);

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
  /* Filtering was re-run for each of the 42 month cells on every render, and
     `lessonState` builds a `Date` per lesson — so a clock tick or a filter tap
     re-derived the whole month. One map, rebuilt only when its inputs change. */
  const visibleLessonsByDate = useMemo(() => {
    const result = new Map<string, AttendanceCalendarLesson[]>();
    for (const [dateKey, dayLessons] of lessonsByDate) {
      result.set(dateKey, dayLessons.filter((lesson) => !hiddenStates.has(lessonState(lesson, now))));
    }
    return result;
  }, [hiddenStates, lessonsByDate, now]);
  const visibleLessonsFor = (dateKey: string) => visibleLessonsByDate.get(dateKey) ?? [];
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
  const nextUpcoming = useMemo(() => (
    [...lessons]
      .filter((lesson) => lessonState(lesson, now) === 'upcoming')
      .sort((left, right) => (
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      ))[0] ?? null
  ), [lessons, now]);

  const shift = (direction: number) => {
    setAnchorKey((current) => (
      effectiveView === 'month'
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

  const anchorDate = dateFromDayKey(anchorKey);
  const rangeLabel = effectiveView === 'month'
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(anchorDate)
    : `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(calendarDays[0].date)} — ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(calendarDays[calendarDays.length - 1].date)}`;
  const atToday = effectiveView === 'month'
    ? anchorKey.slice(0, 7) === todayKey.slice(0, 7)
    : weekStartDayKey(anchorKey) === weekStartDayKey(todayKey);

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

  const jumpToUpcoming = () => {
    if (!nextUpcoming) return;
    setAnchorKey(academyDateKey(nextUpcoming.scheduledAt));
    setHiddenStates(new Set());
  };

  const lessonButton = (lesson: AttendanceCalendarLesson, roomy = false) => {
    const state = lessonState(lesson, now);
    const tone = STATE_TONES[state];
    const isSelected = String(lesson.id) === selectedLessonId;
    const time = new Date(lesson.scheduledAt).toLocaleTimeString(locale, {
      timeZone: ACADEMY_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      // Hard 24h like every other time surface in the app.
      hour12: false,
    });

    return (
      <button
        key={lesson.id}
        type="button"
        data-testid={`attendance-calendar-lesson-${lesson.id}`}
        disabled={disabled}
        /* The chip opens the attendance dialog, it does not toggle anything —
           `aria-pressed` promised a switch that never existed. */
        aria-haspopup="dialog"
        aria-current={isSelected ? 'true' : undefined}
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
        <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
          <Clock3 className="size-3" aria-hidden="true" />
          {time}
        </span>
        <span className={cn('block truncate font-medium', roomy ? 'mt-1 text-sm' : 'text-xs')}>
          {lesson.topic}
        </span>
        <span className={cn('block truncate opacity-90', roomy ? 'mt-0.5 text-xs' : 'text-xs')}>
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
              className="min-h-11 gap-1.5"
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
          previousLabel={effectiveView === 'month' ? t('previousMonth') : t('previousWeek')}
          nextLabel={effectiveView === 'month' ? t('nextMonth') : t('nextWeek')}
          atToday={atToday}
          onPrevious={() => shift(-1)}
          onNext={() => shift(1)}
          onToday={goToday}
          views={isCompactViewport ? COMPACT_VIEWS : VIEWS}
          view={effectiveView}
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
                  'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  'max-md:min-h-11 max-md:px-4',
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

      <CardContent className="relative p-0">
        {/* "Nothing here" and "everything is filtered out" are different
            statements, and the second one needs a way out. The message is an
            overlay rather than an extra block: inserting it above the grid
            still moved everything below it by ~140px on every filter tap,
            which is the layout jump P1-27 was about. */}
        {visibleRangeCount === 0 ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/85 px-6 py-8 text-center backdrop-blur-[2px]">
            <EmptyState
              icon={CalendarDays}
              className="py-0"
              title={hiddenStates.size > 0 ? t('lessonsHiddenByFilters') : t('noLessonsInRange')}
              description={hiddenStates.size > 0 ? t('lessonsHiddenByFiltersHint') : t('scheduleEmptyWeekHint')}
              action={hiddenStates.size > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setHiddenStates(new Set())}
                >
                  {t('resetFilters')}
                </Button>
              ) : nextUpcoming ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 gap-1.5"
                  onClick={jumpToUpcoming}
                >
                  <CalendarClock />
                  {t('showNextLesson')}
                </Button>
              ) : undefined}
            />
          </div>
        ) : null}

        {effectiveView === 'agenda' ? (
          <div className="max-h-[32rem] min-h-56 divide-y divide-border/60 overflow-auto overscroll-contain">
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
            <div className={cn(effectiveView === 'month' ? 'min-w-[760px]' : 'min-w-[640px]')}>
              <div className="grid grid-cols-7 border-b bg-muted/30">
                {dayNames.map((dayName, index) => (
                  <div
                    key={`day-header-${index}`}
                    className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {dayName}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const dayLessons = visibleLessonsFor(day.dateKey);
                  const isExpanded = expandedDayKey === day.dateKey;
                  const shown = effectiveView === 'month' && !isExpanded
                    ? dayLessons.slice(0, VISIBLE_PER_DAY)
                    : dayLessons;
                  const overflow = dayLessons.length - shown.length;
                  const canExpandDay = effectiveView === 'month' && dayLessons.length > VISIBLE_PER_DAY;
                  const isToday = day.dateKey === todayKey;

                  return (
                    <div
                      key={day.dateKey}
                      className={cn(
                        'flex flex-col gap-1 border-b border-r border-border/70 p-1.5 [&:nth-child(7n)]:border-r-0',
                        effectiveView === 'month' ? 'min-h-28' : 'min-h-40',
                        !day.isCurrentMonth && 'bg-muted/20 text-muted-foreground',
                        isToday && 'bg-primary/[0.05]',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                            isToday && 'bg-primary text-primary-foreground',
                          )}
                        >
                          {day.date.getUTCDate()}
                        </span>
                        {dayLessons.some((lesson) => lesson.status === 'conducted') ? (
                          <CircleCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
                        ) : null}
                      </div>
                      <div id={`attendance-day-${day.dateKey}`} className="flex flex-col gap-1">
                        {shown.map((lesson) => lessonButton(lesson))}
                      </div>
                      {/* One trigger with a real `aria-expanded` and an
                          `aria-controls` pointing at the list it opens, instead
                          of two buttons with the value hardcoded. Expanding a
                          crowded day must not rewrite the teacher's saved
                          default view for every future visit — it only opens
                          this cell. */}
                      {canExpandDay ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={`attendance-day-${day.dateKey}`}
                          className="min-h-9 rounded px-1 py-0.5 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => toggleExpandedDay(day.dateKey)}
                        >
                          {isExpanded
                            ? t('collapseDay')
                            : t('moreEventsCount').replace('{count}', String(overflow))}
                        </button>
                      ) : null}
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
