import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useIsMobileViewport } from '@/hooks/useMediaQuery';
import { assignCalendarLanes } from '@/lib/calendarLanes';
import { buildCalendarTimeScale, getCalendarMinutePosition, type CalendarTimeScale } from '@/lib/calendarTimeScale';
import { TEACHER_TONE_CLASS } from '@/lib/teacherModule';
import { cn } from '@/lib/utils';
import {
  formatClockMinutes,
  formatSlotTime,
  groupNameParts,
  groupScheduleSlots,
  groupSeats,
  type GroupSeatTone,
  type ScheduleSlot,
} from './presentation';
import { SEAT_TONE_LABEL_KEYS, useGroupLabels } from './useGroupLabels';
import type { Group } from './types';

const HOUR_SIZE = 56;
const TIME_COLUMN_WIDTH = 56;
const MIN_BLOCK_HEIGHT = 34;
/** Tall enough for a third line — the seats — under the name and the time. */
const ROOMY_BLOCK_HEIGHT = 50;
const WEEKDAYS = [1, 2, 3, 4, 5, 6];
const SEAT_TONES: GroupSeatTone[] = ['available', 'few', 'full', 'closed'];

const SEAT_TONE_CLASS = {
  available: TEACHER_TONE_CLASS.success,
  few: TEACHER_TONE_CLASS.warning,
  full: TEACHER_TONE_CLASS.danger,
  closed: TEACHER_TONE_CLASS.neutral,
} as const satisfies Record<GroupSeatTone, string>;

interface WeekSlot extends ScheduleSlot {
  key: string;
  group: Group;
}

interface GroupWeekViewProps {
  groups: Group[];
  todayKey: string;
  emptyState: ReactNode;
  onOpen: (group: Group) => void;
}

const weekdayOfKey = (key: string) => {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

function useDayNames() {
  const { t } = useTranslation();
  return {
    short: [t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'), t('fridayShort'), t('saturdayShort'), t('sundayShort')],
    full: [t('monday'), t('tuesday'), t('wednesday'), t('thursday'), t('friday'), t('saturday'), t('sunday')],
  };
}

function WeekBlock({ slot, scale, dayName, onOpen }: {
  slot: WeekSlot & { lane: number; laneCount: number };
  scale: CalendarTimeScale;
  dayName: string;
  onOpen: (group: Group) => void;
}) {
  const { seatShortLabel } = useGroupLabels();
  const seats = groupSeats(slot.group);
  const { title, shortLabel } = groupNameParts(slot.group.name);
  const top = getCalendarMinutePosition(scale, slot.startMinutes);
  const height = Math.max(MIN_BLOCK_HEIGHT, getCalendarMinutePosition(scale, slot.endMinutes) - top - 2);
  const time = formatSlotTime(slot);
  const seatText = seatShortLabel(seats);
  return (
    <button
      type="button"
      className={cn(
        'absolute flex flex-col overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-xs transition-shadow',
        'hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        SEAT_TONE_CLASS[seats.tone],
      )}
      style={{
        top,
        height,
        left: `calc(${slot.lane} * (100% / ${slot.laneCount}) + 2px)`,
        width: `calc(100% / ${slot.laneCount} - 4px)`,
      }}
      aria-label={`${title}, ${dayName} ${time}, ${seatText}`}
      title={`${slot.group.name} · ${time} · ${seatText}`}
      onClick={() => onOpen(slot.group)}
    >
      <span className="truncate font-semibold">{shortLabel}</span>
      <span className="truncate tabular-nums opacity-80">{time}</span>
      {height >= ROOMY_BLOCK_HEIGHT ? <span className="truncate font-medium">{seatText}</span> : null}
    </button>
  );
}

function WeekGrid({ slots, days, todayDay, onOpen }: {
  slots: WeekSlot[];
  days: number[];
  todayDay: number;
  onOpen: (group: Group) => void;
}) {
  const dayNames = useDayNames();
  const scale = useMemo(() => buildCalendarTimeScale(slots, { hourSize: HOUR_SIZE }), [slots]);
  const lanesByDay = useMemo(() => new Map(days.map((day) => [
    day,
    assignCalendarLanes(slots.filter((slot) => slot.dayOfWeek === day)),
  ])), [days, slots]);
  const columns = `${TIME_COLUMN_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    /* Seven readable columns need ~46rem; narrower panes scroll the grid, not the page. */
    <div className="overflow-x-auto">
      <div className="min-w-[46rem]">
        <div className="grid border-b border-border bg-muted/50" style={{ gridTemplateColumns: columns }}>
          <div />
          {days.map((day) => (
            <div key={day} className={cn(
              'px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
              day === todayDay && 'text-primary',
            )}>
              {dayNames.short[day - 1]}
              <span className="ml-1.5 font-normal tabular-nums">{lanesByDay.get(day)?.length ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="relative grid" style={{ gridTemplateColumns: columns, height: scale.totalSize }}>
          <div className="relative border-r border-border/60" aria-hidden="true">
            {scale.markers.map((marker) => (
              <span key={marker.minutes} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: marker.offset }}>
                {formatClockMinutes(marker.minutes)}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} className={cn('relative border-r border-border/40 last:border-r-0', day === todayDay && 'bg-primary/[0.03]')}>
              {scale.markers.map((marker) => (
                <div key={marker.minutes} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-border/50" style={{ top: marker.offset }} />
              ))}
              {scale.segments.filter((segment) => segment.kind === 'collapsed').map((segment) => (
                <div key={segment.startMinutes} aria-hidden="true" className="absolute inset-x-0 bg-muted/50" style={{ top: segment.offset, height: segment.size }} />
              ))}
              {(lanesByDay.get(day) ?? []).map((slot) => (
                <WeekBlock key={slot.key} slot={slot} scale={scale} dayName={dayNames.full[day - 1]} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A phone gets one day at a time as a list: seven 45px columns hold nothing readable. */
function DayAgenda({ slots, days, todayDay, onOpen }: {
  slots: WeekSlot[];
  days: number[];
  todayDay: number;
  onOpen: (group: Group) => void;
}) {
  const { t } = useTranslation();
  const dayNames = useDayNames();
  const { seatShortLabel } = useGroupLabels();
  const busyDays = days.filter((day) => slots.some((slot) => slot.dayOfWeek === day));
  const [selectedDay, setSelectedDay] = useState(() => (busyDays.includes(todayDay) ? todayDay : busyDays[0] ?? days[0]));
  const daySlots = slots
    .filter((slot) => slot.dayOfWeek === selectedDay)
    .sort((left, right) => left.startMinutes - right.startMinutes);

  return (
    <div>
      <div role="group" aria-label={t('schedule')} className="flex gap-1 overflow-x-auto border-b border-border p-2">
        {days.map((day) => {
          const count = slots.filter((slot) => slot.dayOfWeek === day).length;
          return (
            <Button
              key={day}
              type="button"
              variant={selectedDay === day ? 'secondary' : 'ghost'}
              aria-pressed={selectedDay === day}
              aria-label={dayNames.full[day - 1]}
              className={cn('min-h-11 min-w-11 flex-1 flex-col gap-0 px-1', day === todayDay && 'text-primary')}
              onClick={() => setSelectedDay(day)}
            >
              <span className="text-xs font-semibold">{dayNames.short[day - 1]}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
            </Button>
          );
        })}
      </div>
      {daySlots.length > 0 ? (
        <ul className="divide-y divide-border/60">
          {daySlots.map((slot) => {
            const seats = groupSeats(slot.group);
            return (
              <li key={slot.key}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent/50" onClick={() => onOpen(slot.group)}>
                  <span className="w-[5.5rem] shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatSlotTime(slot)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{groupNameParts(slot.group.name).title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[slot.group.courseName, slot.group.schoolName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium', SEAT_TONE_CLASS[seats.tone])}>
                    {seatShortLabel(seats)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('groupsWeekDayEmpty')}</p>
      )}
    </div>
  );
}

/**
 * The same groups laid out by weekday and hour, coloured by free seats — the
 * shape of "what can we offer on weekday evenings" in one look.
 */
export function GroupWeekView({ groups, todayKey, emptyState, onOpen }: GroupWeekViewProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobileViewport();
  const todayDay = weekdayOfKey(todayKey);
  const { slots, unscheduled } = useMemo(() => {
    const weekSlots: WeekSlot[] = [];
    const withoutSchedule: Group[] = [];
    for (const group of groups) {
      const groupSlots = groupScheduleSlots(group);
      if (groupSlots.length === 0) withoutSchedule.push(group);
      for (const slot of groupSlots) {
        weekSlots.push({ ...slot, key: `${group.id}-${slot.dayOfWeek}-${slot.startMinutes}`, group });
      }
    }
    return { slots: weekSlots, unscheduled: withoutSchedule };
  }, [groups]);
  const days = useMemo(() => (slots.some((slot) => slot.dayOfWeek === 7) ? [...WEEKDAYS, 7] : WEEKDAYS), [slots]);

  if (groups.length === 0) return <>{emptyState}</>;

  return (
    <div>
      {slots.length > 0 ? (
        isMobile
          ? <DayAgenda slots={slots} days={days} todayDay={todayDay} onOpen={onOpen} />
          : <WeekGrid slots={slots} days={days} todayDay={todayDay} onOpen={onOpen} />
      ) : null}
      {unscheduled.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">{t('groupsWithoutSchedule')}:</span>
          {unscheduled.map((group) => (
            <Button key={group.id} type="button" variant="outline" size="sm" className="h-8" onClick={() => onOpen(group)}>
              {groupNameParts(group.name).shortLabel}
            </Button>
          ))}
        </div>
      ) : null}
      {slots.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {SEAT_TONES.map((tone) => (
            <li key={tone} className="flex items-center gap-1.5">
              <span className={cn('size-3 rounded-sm border', SEAT_TONE_CLASS[tone])} aria-hidden="true" />
              {t(SEAT_TONE_LABEL_KEYS[tone])}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
