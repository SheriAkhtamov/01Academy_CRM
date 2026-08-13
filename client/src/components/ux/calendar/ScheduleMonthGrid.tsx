import { format, isSameDay, isSameMonth } from 'date-fns';
import type { Locale } from 'date-fns';
import {
  calendarToneAt,
  DEMO_TONE,
  formatCalendarMinutes,
} from '@/components/ux/calendar/calendarTones';
import { useTranslation } from '@/hooks/useTranslation';
import type { SalesScheduleEvent } from '@/lib/salesSchedule';
import { cn } from '@/lib/utils';

interface ScheduleMonthGridProps {
  days: Date[];
  monthAnchor: Date;
  eventsByDate: Map<string, SalesScheduleEvent[]>;
  now: Date;
  locale: Locale;
  dayNames: string[];
  groupIndexById: Map<number, number>;
  onSelectEvent: (event: SalesScheduleEvent) => void;
  onSelectDay: (day: Date) => void;
}

const VISIBLE_PER_DAY = 3;

const dateKey = (day: Date) => (
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
);

export function ScheduleMonthGrid({
  days,
  monthAnchor,
  eventsByDate,
  now,
  locale,
  dayNames,
  groupIndexById,
  onSelectEvent,
  onSelectDay,
}: ScheduleMonthGridProps) {
  const { t } = useTranslation();

  return (
    <div className="h-full overflow-auto overscroll-contain">
      <div className="min-w-[640px]">
        <div className="sticky top-0 z-20 grid grid-cols-7 border-b border-border bg-card/95 backdrop-blur-sm">
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
          {days.map((day) => {
            const key = dateKey(day);
            const dayEvents = eventsByDate.get(key) ?? [];
            const outside = !isSameMonth(day, monthAnchor);
            const today = isSameDay(day, now);
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            const overflow = dayEvents.length - VISIBLE_PER_DAY;

            return (
              <div
                key={key}
                className={cn(
                  'flex min-h-24 flex-col gap-1 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0',
                  weekend && 'bg-muted/20',
                  outside && 'bg-muted/30 opacity-60',
                  today && 'bg-primary/[0.05]',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-label={format(day, 'EEEE, d MMMM', { locale })}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      today && 'bg-primary text-primary-foreground hover:bg-primary/90',
                    )}
                    onClick={() => onSelectDay(day)}
                  >
                    {format(day, 'd')}
                  </button>
                  {dayEvents.length > 0 ? (
                    <span className="rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {dayEvents.length}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-0.5">
                  {dayEvents.slice(0, VISIBLE_PER_DAY).map((event) => {
                    const tone = event.source === 'demo'
                      ? DEMO_TONE
                      : calendarToneAt(groupIndexById.get(event.groupId) ?? 0);
                    const eventName = event.source === 'demo' ? t('demoLesson') : event.groupName;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        className="flex min-w-0 items-center gap-1 rounded border-l-2 px-1 py-0.5 text-left text-[10px] font-medium hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{
                          backgroundColor: tone.background,
                          borderLeftColor: tone.solid,
                          color: tone.foreground,
                        }}
                        aria-label={`${formatCalendarMinutes(event.startMinutes)}, ${eventName}`}
                        onClick={() => onSelectEvent(event)}
                      >
                        <span className="shrink-0 tabular-nums opacity-80">
                          {formatCalendarMinutes(event.startMinutes)}
                        </span>
                        <span className="min-w-0 truncate">{eventName}</span>
                      </button>
                    );
                  })}
                  {overflow > 0 ? (
                    <button
                      type="button"
                      className="rounded px-1 py-0.5 text-left text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onSelectDay(day)}
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
  );
}
