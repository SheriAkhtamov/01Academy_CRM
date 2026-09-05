import { useEffect, useRef, type ReactNode } from 'react';
import { format, isSameDay } from 'date-fns';
import type { Locale } from 'date-fns';
import { Minimize2, UserRoundCheck } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  calendarToneAt,
  DEMO_TONE,
  formatCalendarMinutes,
} from '@/components/ux/calendar/calendarTones';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getCalendarMinuteAtPosition,
  getCalendarMinutePosition,
  isCalendarMinuteCollapsed,
  type CalendarTimeScale,
} from '@/lib/calendarTimeScale';
import type { PositionedScheduleEvent, SalesScheduleEvent } from '@/lib/salesSchedule';
import { cn } from '@/lib/utils';

interface ScheduleTimeGridProps {
  days: Date[];
  events: PositionedScheduleEvent[];
  timeScale: CalendarTimeScale;
  now: Date;
  locale: Locale;
  groupIndexById: Map<number, number>;
  onSelectEvent: (event: SalesScheduleEvent) => void;
  onCreateAt?: (day: Date, minutes: number) => void;
  emptyState?: ReactNode;
}

export const TIME_COLUMN_WIDTH = 56;
export const SCHEDULE_HOUR_HEIGHT = 64;
const MIN_DAY_WIDTH = 104;
const MIN_EVENT_HEIGHT = 30;

const eventPositionStyle = (
  event: PositionedScheduleEvent,
  timeScale: CalendarTimeScale,
  dayCount: number,
) => {
  const dayWidth = `(100% - ${TIME_COLUMN_WIDTH}px) / ${dayCount}`;
  const laneWidth = `(${dayWidth}) / ${event.laneCount}`;
  const top = getCalendarMinutePosition(timeScale, event.startMinutes);
  const height = Math.max(
    MIN_EVENT_HEIGHT,
    getCalendarMinutePosition(timeScale, event.endMinutes) - top - 3,
  );

  return {
    left: `calc(${TIME_COLUMN_WIDTH}px + (${dayWidth}) * ${event.dayIndex} + (${laneWidth}) * ${event.lane} + 2px)`,
    width: `calc(${laneWidth} - 4px)`,
    top,
    height,
  };
};

export function ScheduleTimeGrid({
  days,
  events,
  timeScale,
  now,
  locale,
  groupIndexById,
  onSelectEvent,
  onCreateAt,
  emptyState,
}: ScheduleTimeGridProps) {
  const { t } = useTranslation();
  const dayCount = Math.max(1, days.length);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const todayIndex = days.findIndex((day) => isSameDay(day, now));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef({ signature: '', dateKey: '', top: -1 });

  useEffect(() => {
    const element = scrollRef.current;
    const entry = todayIndex >= 0 ? days[todayIndex] : null;
    if (!element || typeof element.scrollTo !== 'function' || !entry) return;
    const dateKey = format(entry, 'yyyy-MM-dd');
    const signature = `${dateKey}|${timeScale.startMinutes}-${timeScale.endMinutes}-${Math.round(timeScale.totalSize)}`;
    const previous = autoScrollRef.current;
    if (previous.signature === signature) return;
    const target = Math.max(
      0,
      getCalendarMinutePosition(timeScale, currentMinutes) - element.clientHeight / 3,
    );
    const userScrolled = previous.dateKey === dateKey
      && previous.top >= 0
      && Math.abs(element.scrollTop - previous.top) > 1;
    const appliedTop = Math.min(target, Math.max(0, element.scrollHeight - element.clientHeight));
    autoScrollRef.current = { signature, dateKey, top: userScrolled ? previous.top : appliedTop };
    if (userScrolled) return;
    element.scrollTo({ top: target, behavior: 'auto' });
  });

  const showCurrentTime = todayIndex >= 0
    && timeScale.markers.length > 0
    && currentMinutes >= timeScale.startMinutes
    && currentMinutes < timeScale.endMinutes
    && !isCalendarMinuteCollapsed(timeScale, currentMinutes);
  const currentTimeTop = getCalendarMinutePosition(timeScale, currentMinutes);

  const handleBackgroundClick = (
    day: Date,
    clickEvent: { currentTarget: HTMLElement; clientY: number },
  ) => {
    if (!onCreateAt) return;
    const bounds = clickEvent.currentTarget.getBoundingClientRect();
    const minutes = getCalendarMinuteAtPosition(timeScale, clickEvent.clientY - bounds.top, 15);
    onCreateAt(day, minutes);
  };

  return (
    <div ref={scrollRef} className="h-full overflow-auto overscroll-contain [scrollbar-gutter:stable]">
      <div style={{ minWidth: TIME_COLUMN_WIDTH + dayCount * MIN_DAY_WIDTH }}>
        <div
          className="sticky top-0 z-30 grid border-b border-border bg-card/95 backdrop-blur-sm"
          style={{
            gridTemplateColumns: `${TIME_COLUMN_WIDTH}px repeat(${dayCount}, minmax(0, 1fr))`,
          }}
        >
          <div className="border-r border-border" />
          {days.map((day) => {
            const today = isSameDay(day, now);
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 border-r border-border px-1 py-1.5 last:border-r-0',
                  today && 'bg-primary/5',
                )}
              >
                <span className={cn(
                  'text-[10px] font-semibold uppercase tracking-wide',
                  today ? 'text-primary' : 'text-muted-foreground',
                )}>
                  {format(day, 'EEE', { locale })}
                </span>
                <span className={cn(
                  'flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                  today ? 'bg-primary text-primary-foreground shadow-primary' : 'text-foreground',
                )}>
                  {format(day, 'd')}
                </span>
              </div>
            );
          })}
        </div>

        <div className="relative bg-card" style={{ height: timeScale.totalSize }}>
          <div
            className="absolute inset-y-0 right-0 grid"
            style={{
              left: TIME_COLUMN_WIDTH,
              gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
            }}
          >
            {days.map((day) => {
              const today = isSameDay(day, now);
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              const dayLabel = format(day, 'EEEE, d MMMM', { locale });
              const background = cn(
                'border-r border-border last:border-r-0',
                weekend && 'bg-muted/25',
                today && 'bg-primary/[0.04]',
              );

              return onCreateAt ? (
                <button
                  key={day.toISOString()}
                  type="button"
                  // Pointer-only: keyboard users reach the same dialog from the
                  // toolbar without tabbing through seven full-height targets.
                  tabIndex={-1}
                  aria-label={`${t('createDemoLesson')}: ${dayLabel}`}
                  className={cn(background, 'cursor-copy outline-none')}
                  onClick={(clickEvent) => handleBackgroundClick(day, clickEvent)}
                />
              ) : (
                <div key={day.toISOString()} className={background} aria-hidden="true" />
              );
            })}
          </div>

          {timeScale.markers.map((marker) => (
            <div key={marker.minutes}>
              <span
                className="pointer-events-none absolute left-0 w-14 -translate-y-1/2 pr-2 text-right text-[10px] font-medium tabular-nums text-muted-foreground"
                style={{ top: marker.offset === 0 ? 8 : marker.offset }}
              >
                {formatCalendarMinutes(marker.minutes)}
              </span>
              <div
                className="pointer-events-none absolute right-0 border-t border-border/70"
                style={{ left: TIME_COLUMN_WIDTH, top: marker.offset }}
                aria-hidden="true"
              />
            </div>
          ))}

          {/* Tied to the markers, not to the filtered events: the scale is built
              from the whole range, so hiding every group must not leave the hour
              lines spread over gaps that no longer announce themselves. */}
          {timeScale.markers.length > 0 ? timeScale.segments
            .filter((segment) => segment.kind === 'collapsed')
            .map((segment) => {
              const start = formatCalendarMinutes(segment.startMinutes);
              const end = formatCalendarMinutes(segment.endMinutes);
              return (
                <div
                  key={`${segment.startMinutes}-${segment.endMinutes}`}
                  className="pointer-events-none absolute right-0 z-[5] flex items-center justify-center border-y border-dashed border-border bg-muted/70 px-3"
                  style={{ left: TIME_COLUMN_WIDTH, top: segment.offset, height: segment.size }}
                  role="note"
                  aria-label={t('collapsedScheduleGap')
                    .replace('{start}', start)
                    .replace('{end}', end)}
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-2xs">
                    <Minimize2 className="size-3" aria-hidden="true" />
                    {start}–{end} · {t('noLessonsShort')}
                  </span>
                </div>
              );
            }) : null}

          <TooltipProvider delayDuration={250}>
            {events.map((event) => {
              const tone = event.source === 'demo'
                ? DEMO_TONE
                : calendarToneAt(groupIndexById.get(event.groupId) ?? 0);
              const style = eventPositionStyle(event, timeScale, dayCount);
              const eventName = event.source === 'demo' ? t('demoLesson') : event.groupName;
              const timeRange = `${formatCalendarMinutes(event.startMinutes)}–${formatCalendarMinutes(event.endMinutes)}`;
              const roomy = style.height >= 56;
              const spacious = style.height >= 78;

              return (
                <Tooltip key={event.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'group absolute z-10 flex flex-col overflow-hidden rounded-md border pl-2 pr-1.5 py-1 text-left shadow-2xs outline-none',
                        // Raising z-index alongside the scale keeps a hovered
                        // lesson on top of the ones it overlaps in the grid.
                        'transition-[box-shadow,transform] duration-150 ease-out hover:z-20 hover:scale-[1.015] hover:shadow-lg active:scale-100 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      )}
                      style={{
                        ...style,
                        backgroundColor: tone.background,
                        borderColor: tone.border,
                        color: tone.foreground,
                        borderLeftWidth: 3,
                        borderLeftColor: tone.solid,
                      }}
                      aria-label={`${timeRange}, ${eventName}`}
                      onClick={() => onSelectEvent(event)}
                    >
                      <span className="truncate text-xs font-semibold leading-tight">{eventName}</span>
                      <span className="truncate text-[10px] font-medium tabular-nums opacity-80">
                        {timeRange}
                      </span>
                      {roomy ? (
                        <span className="truncate text-[10px] opacity-75">
                          {event.teacherName || t('teacherWillBeAssigned')}
                        </span>
                      ) : null}
                      {spacious ? (
                        <span className="mt-auto flex items-center gap-1 truncate text-[10px] opacity-75">
                          <UserRoundCheck className="size-3 shrink-0" aria-hidden="true" />
                          {event.source === 'demo'
                            ? `${event.participantCount ?? 0} ${t('demoParticipantsShort')}`
                            : `${event.availableSeats ?? 0}/${event.maxStudents ?? 12}`}
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-64">
                    <p className="font-semibold">{eventName}</p>
                    <p className="text-xs opacity-80">
                      {timeRange} · {event.topic || event.courseName || t('lessonColumn')}
                    </p>
                    <p className="text-xs opacity-80">
                      {event.teacherName || t('teacherWillBeAssigned')}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">
                      {t('openLessonDetails')}
                    </p>
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
              <span className="absolute -left-1 -top-1.5 size-3 rounded-full border-2 border-card bg-destructive" />
              <span className="absolute -top-2 right-1 rounded-full bg-destructive px-1.5 text-[10px] font-semibold tabular-nums text-destructive-foreground">
                {formatCalendarMinutes(currentMinutes)}
              </span>
            </div>
          ) : null}

          {events.length === 0 && emptyState ? (
            <div className="absolute inset-x-4 top-8 z-10 flex justify-center">{emptyState}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
