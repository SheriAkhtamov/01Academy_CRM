import type { ReactNode } from 'react';
import { format, isSameDay } from 'date-fns';
import type { Locale } from 'date-fns';
import { UserRoundCheck } from 'lucide-react';
import {
  calendarToneAt,
  DEMO_TONE,
  formatCalendarMinutes,
} from '@/components/ux/calendar/calendarTones';
import { useTranslation } from '@/hooks/useTranslation';
import type { SalesScheduleEvent } from '@/lib/salesSchedule';
import { cn } from '@/lib/utils';

interface ScheduleAgendaListProps {
  days: Date[];
  eventsByDate: Map<string, SalesScheduleEvent[]>;
  now: Date;
  locale: Locale;
  groupIndexById: Map<number, number>;
  onSelectEvent: (event: SalesScheduleEvent) => void;
  emptyState?: ReactNode;
}

const dateKey = (day: Date) => (
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
);

/**
 * The grid answers "when is the room free"; the agenda answers "what happens
 * next". It is also the only shape that survives a phone screen, so the
 * calendar falls back to it instead of hiding a seven-column grid behind
 * horizontal scroll.
 */
export function ScheduleAgendaList({
  days,
  eventsByDate,
  now,
  locale,
  groupIndexById,
  onSelectEvent,
  emptyState,
}: ScheduleAgendaListProps) {
  const { t } = useTranslation();
  const populatedDays = days.filter((day) => (eventsByDate.get(dateKey(day))?.length ?? 0) > 0);

  if (populatedDays.length === 0) {
    return (
      <div className="flex min-h-64 items-start justify-center p-6">{emptyState}</div>
    );
  }

  return (
    <div className="h-full overflow-auto overscroll-contain">
      {populatedDays.map((day) => {
        const dayEvents = eventsByDate.get(dateKey(day)) ?? [];
        const today = isSameDay(day, now);

        return (
          <section key={dateKey(day)}>
            <h3 className={cn(
              'sticky top-0 z-10 flex items-center gap-2 border-y border-border bg-muted/70 px-4 py-1.5 text-xs font-semibold capitalize backdrop-blur-sm',
              today ? 'text-primary' : 'text-muted-foreground',
            )}>
              <span className={cn(
                'flex size-5 items-center justify-center rounded-full text-[10px] tabular-nums',
                today ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground',
              )}>
                {format(day, 'd')}
              </span>
              {format(day, 'EEEE, d MMMM', { locale })}
              <span className="ml-auto font-medium tabular-nums">{dayEvents.length}</span>
            </h3>

            <ul className="divide-y divide-border/60">
              {dayEvents.map((event) => {
                const tone = event.source === 'demo'
                  ? DEMO_TONE
                  : calendarToneAt(groupIndexById.get(event.groupId) ?? 0);
                const eventName = event.source === 'demo' ? t('demoLesson') : event.groupName;
                const timeRange = `${formatCalendarMinutes(event.startMinutes)}–${formatCalendarMinutes(event.endMinutes)}`;
                const running = today
                  && now.getHours() * 60 + now.getMinutes() >= event.startMinutes
                  && now.getHours() * 60 + now.getMinutes() < event.endMinutes;

                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      aria-label={`${timeRange}, ${eventName}`}
                      onClick={() => onSelectEvent(event)}
                    >
                      <span className="w-24 shrink-0 text-xs font-semibold tabular-nums text-foreground">
                        {timeRange}
                      </span>
                      <span
                        className="h-9 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: tone.solid }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {eventName}
                          </span>
                          {running ? (
                            <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                              {t('now')}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[
                            event.topic || event.courseName,
                            event.teacherName || t('teacherWillBeAssigned'),
                            event.schoolName,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="hidden shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground sm:flex">
                        <UserRoundCheck className="size-3.5" aria-hidden="true" />
                        {event.source === 'demo'
                          ? `${event.participantCount ?? 0}`
                          : `${event.availableSeats ?? 0}/${event.maxStudents ?? 12}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
