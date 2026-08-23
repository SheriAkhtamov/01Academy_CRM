import { useMemo } from 'react';
import { CalendarDays, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CalendarNavigator } from '@/components/ux/calendar/CalendarNavigator';
import { EmptyState } from '@/components/ux/EmptyState';
import { LessonStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { TruncatedText } from '@/components/ux/teacher/TruncatedText';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate, resolveLocale } from '@/lib/localeFormat';
import {
  TEACHER_CARD_PADDING,
  TEACHER_CARD_PADDING_DENSE,
  type TeacherLesson,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';

export type TeacherScheduleDayView = {
  dateKey: string;
  date: Date;
  weekdayIndex: number;
  lessons: TeacherLesson[];
};

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
}

/**
 * The week used to be hardcoded to "today plus six days" with no way back or
 * forward, and it collapsed straight from seven columns to one — seven cards
 * stacked into a page several screens tall on any tablet. It is now a real
 * week the teacher can walk through, and the column count steps down through
 * the breakpoints instead of falling off a cliff.
 */
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
}: TeacherScheduleSectionProps) {
  const { t, language } = useTranslation();
  const locale = resolveLocale(language);

  const weekLessons = useMemo(
    () => days.reduce((total, day) => total + day.lessons.length, 0),
    [days],
  );
  const weekConducted = useMemo(
    () => days.reduce(
      (total, day) => total + day.lessons.filter((lesson) => lesson.status === 'conducted').length,
      0,
    ),
    [days],
  );
  /* Counts what the phone layout actually collapses, which is not every empty
     day: today's column stays on screen even with nothing in it, so including
     it here made the summary claim one more hidden day than there were. */
  const emptyDayCount = useMemo(
    () => days.filter((day) => day.lessons.length === 0 && day.dateKey !== todayKey).length,
    [days, todayKey],
  );

  /* Constructing an `Intl.DateTimeFormat` is one of the more expensive calls in
     date formatting, and the parent re-renders on a 30-second clock tick. Nine
     constructors per render (two here plus one inside each of seven days) is
     now three, built once per locale. */
  const formatters = useMemo(() => ({
    dayMonth: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    dayMonthYear: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  }), [locale]);

  const rangeLabel = days.length > 0
    ? `${formatters.dayMonth.format(days[0].date)} — ${formatters.dayMonthYear.format(days[days.length - 1].date)}`
    : '';

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className={TEACHER_CARD_PADDING_DENSE}>
          <CalendarNavigator
            label={rangeLabel}
            hint={(
              <span className="tabular-nums">
                {t('scheduleWeekLessonsSummary')
                  .replace('{total}', String(weekLessons))
                  .replace('{conducted}', String(weekConducted))}
              </span>
            )}
            previousLabel={t('previousWeek')}
            nextLabel={t('nextWeek')}
            atToday={atToday}
            onPrevious={onPreviousWeek}
            onNext={onNextWeek}
            onToday={onToday}
          />
        </CardContent>
      </Card>

      {weekLessons === 0 ? (
        <Card className="border-dashed border-border/70">
          <CardContent className="p-0">
            <EmptyState
              icon={CalendarDays}
              title={t('noLessonsInRange')}
              description={t('scheduleEmptyWeekHint')}
              action={nextLesson ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => onOpenNextLesson(String(nextLesson.id))}
                >
                  {t('showNextLesson')}
                </Button>
              ) : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Seven columns only from `2xl`. At 1280px the sidebar (256px), the
              page padding and the scrollbar gutter leave ~960px, which is
              ~127px per column once the gaps are removed — not enough for a
              time and a status badge on one line. Four columns at `xl` give
              ~231px. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
            {days.map((day) => {
              const isTodayColumn = day.dateKey === todayKey;
              const isEmptyDay = day.lessons.length === 0;
              return (
                <Card
                  key={day.dateKey}
                  className={cn(
                    'flex min-w-0 flex-col border-border/70',
                    isTodayColumn && 'border-primary/40 ring-1 ring-primary/25',
                    // In one column an empty day is a whole card saying
                    // "no lessons" — four of them turn a light week into an
                    // extra screen of scrolling on a phone.
                    isEmptyDay && !isTodayColumn && 'max-sm:hidden',
                  )}
                >
                  <CardHeader
                    className={cn(
                      'gap-0 rounded-t-xl px-3 pb-2 pt-3',
                      isTodayColumn && 'bg-primary/5',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn(
                        'text-sm font-semibold capitalize',
                        isTodayColumn ? 'text-primary' : 'text-foreground',
                      )}>
                        {dayNames[day.weekdayIndex]}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatters.dayMonth.format(day.date)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2 px-3 pb-3 pt-0">
                    {isEmptyDay ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        {t('noLessonsThisDay')}
                      </p>
                    ) : null}
                    {day.lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className={cn(
                          'space-y-1.5 rounded-xl border p-2.5 text-xs transition-shadow hover:shadow-sm',
                          isTodayColumn
                            ? 'border-primary/30 bg-primary/5'
                            : 'border-border/60 bg-muted/40',
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatAcademyDate(lesson.scheduledAt, language, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <LessonStatusBadge status={lesson.status} />
                        </div>
                        <TruncatedText
                          text={lesson.groupName || t('noGroup')}
                          className="block font-medium text-foreground"
                        />
                        <TruncatedText
                          text={lesson.topic}
                          className="block text-muted-foreground"
                        />
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {t('durationMinutesValue').replace('{count}', String(lesson.durationMinutes))}
                        </p>
                        {lesson.status === 'scheduled' || lesson.status === 'conducted' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11 w-full rounded-lg text-xs font-medium"
                            onClick={() => onOpenAttendance(String(lesson.id))}
                          >
                            <ClipboardCheck className="mr-1.5 size-3.5" />
                            {t('attendanceLabel')}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {emptyDayCount > 0 ? (
            <p className={cn(
              'rounded-xl border border-dashed border-border/70 text-center text-xs text-muted-foreground sm:hidden',
              TEACHER_CARD_PADDING,
            )}>
              {t('scheduleEmptyDaysCollapsed').replace('{count}', String(emptyDayCount))}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
