import { parseGroupName } from '@shared/academy-group-code';
import { normalizeWeeklySchedule } from '@shared/scheduling';
import { academyDateInputValue, resolveLocale } from '@/lib/localeFormat';
import { availableGroupSeats, filterGroups } from './filters';
import type { Group } from './types';

/**
 * Display rules for the group list and the quick view. They live
 * apart from the components so both describe a group the same way: the
 * same seat arithmetic, the same "starts in N days", the same short name.
 */

const DAY_MS = 86_400_000;
const SELLABLE_STATUSES = new Set(['open', 'in_progress']);

/** Only a group that is enrolling or running can still take a student. */
export const isSellableGroup = (group: Pick<Group, 'status' | 'isArchived'>) => (
  SELLABLE_STATUSES.has(group.status) && !group.isArchived
);

export type GroupSeatTone = 'available' | 'few' | 'full' | 'closed';

export interface GroupSeats {
  current: number;
  reserved: number;
  occupied: number;
  max: number;
  free: number;
  sellable: boolean;
  tone: GroupSeatTone;
}

export function groupSeats(group: Group): GroupSeats {
  const current = Math.max(0, Number(group.currentStudents || 0));
  const reserved = Math.max(0, Number(group.reservedStudents || 0));
  const max = Math.max(0, Number(group.maxStudents || 0));
  const free = availableGroupSeats(group);
  const sellable = isSellableGroup(group);
  // "1–2 seats left" only means something in a real group; an individual
  // course with its single seat free is simply available.
  const tone: GroupSeatTone = !sellable
    ? 'closed'
    : free === 0
      ? 'full'
      : free <= 2 && max > 2 ? 'few' : 'available';
  return { current, reserved, occupied: current + reserved, max, free, sellable, tone };
}

/**
 * A generated name is "CODE — addition". The addition is what people call the
 * group, so it leads; the code stays visible underneath for anyone looking it
 * up. Names that predate the codes are shown exactly as they are.
 */
export function groupNameParts(name: string) {
  const parsed = parseGroupName(name);
  if (!parsed) return { title: name, code: null, shortLabel: name };
  const numbered = `${parsed.course}-${String(parsed.number).padStart(4, '0')}`;
  return {
    title: parsed.addition || parsed.code,
    code: parsed.addition ? parsed.code : null,
    shortLabel: parsed.addition || numbered,
  };
}

export interface ScheduleSlot {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

export const groupScheduleSlots = (group: Group): ScheduleSlot[] => (
  normalizeWeeklySchedule(group.schedule, Number(group.lessonDurationMinutes) || 60)
    .map(({ dayOfWeek, startMinutes, endMinutes }) => ({ dayOfWeek, startMinutes, endMinutes }))
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.startMinutes - right.startMinutes)
);

export const formatClockMinutes = (minutes: number) => (
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
);

export const formatSlotTime = (slot: Pick<ScheduleSlot, 'startMinutes' | 'endMinutes'>) => (
  `${formatClockMinutes(slot.startMinutes)}–${formatClockMinutes(slot.endMinutes)}`
);

/**
 * "Mon, Wed, Fri 18:00–20:00" instead of three separate badges: days that
 * share a time are one fact. A run of three or more days collapses to a range.
 */
export function summarizeSchedule(slots: ScheduleSlot[], shortDayNames: string[]) {
  const byTime = new Map<string, { days: number[]; time: string }>();
  for (const slot of slots) {
    const time = formatSlotTime(slot);
    const entry = byTime.get(time) ?? { days: [], time };
    if (!entry.days.includes(slot.dayOfWeek)) entry.days.push(slot.dayOfWeek);
    byTime.set(time, entry);
  }
  return [...byTime.values()]
    .sort((left, right) => Math.min(...left.days) - Math.min(...right.days))
    .map(({ days, time }) => ({ days: formatDayRuns(days, shortDayNames), time }));
}

export function formatDayRuns(days: number[], shortDayNames: string[]) {
  const sorted = [...new Set(days)].sort((left, right) => left - right);
  const runs: number[][] = [];
  for (const day of sorted) {
    const run = runs.at(-1);
    if (run && run.at(-1) === day - 1) run.push(day);
    else runs.push([day]);
  }
  const name = (day: number) => shortDayNames[day - 1] ?? String(day);
  return runs.flatMap((run) => (
    run.length >= 3 ? [`${name(run[0])}–${name(run.at(-1)!)}`] : run.map(name)
  )).join(', ');
}

const dayKeyToUtcMs = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** Whole calendar days from one academy date key to another. */
export const daysBetween = (fromKey: string, toKey: string) => (
  Math.round((dayKeyToUtcMs(toKey) - dayKeyToUtcMs(fromKey)) / DAY_MS)
);

export interface GroupTimeline {
  startKey: string;
  endKey: string;
  /** Days until the start; negative once it has passed, null without a start date. */
  daysToStart: number | null;
}

export function groupTimeline(group: Pick<Group, 'startDate' | 'endDate'>, todayKey: string): GroupTimeline {
  const startKey = academyDateInputValue(group.startDate);
  const endKey = academyDateInputValue(group.endDate);
  return { startKey, endKey, daysToStart: startKey ? daysBetween(todayKey, startKey) : null };
}

/** How far ahead or behind a start is still worth spelling out as "in N days". */
export const START_COUNTDOWN_DAYS = 30;

export const relativeDays = (days: number, language: string) => (
  new Intl.RelativeTimeFormat(resolveLocale(language), { numeric: 'auto' }).format(days, 'day')
);

const formatKey = (key: string, language: string, options: Intl.DateTimeFormatOptions) => (
  new Intl.DateTimeFormat(resolveLocale(language), { ...options, timeZone: 'UTC' })
    .format(new Date(dayKeyToUtcMs(key)))
);

/** "12 Oct – 28 Dec", with the year only when it is not the current one. */
export function formatGroupPeriod(timeline: GroupTimeline, language: string, todayKey: string) {
  const { startKey, endKey } = timeline;
  if (!startKey && !endKey) return '';
  const currentYear = todayKey.slice(0, 4);
  const showYear = [startKey, endKey].some((key) => key && key.slice(0, 4) !== currentYear);
  const options: Intl.DateTimeFormatOptions = showYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' };
  const start = startKey ? formatKey(startKey, language, options) : '…';
  const end = endKey ? formatKey(endKey, language, options) : '…';
  return `${start} – ${end}`;
}

export const formatGroupDateLong = (key: string, language: string) => (
  key ? formatKey(key, language, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
);

/**
 * How many groups each option of a filter would leave, given every other
 * active filter. Counting against the other filters — not the whole list — is
 * what makes the number a promise: picking the option shows exactly that many.
 */
export function countFacet(
  groups: Group[],
  params: URLSearchParams,
  facet: 'course' | 'school' | 'teacher' | 'status',
) {
  const others = new URLSearchParams(params);
  others.delete(facet);
  if (facet === 'teacher' && others.get('filter') === 'without-teacher') others.delete('filter');
  const counts = new Map<string, number>();
  const bump = (value: string) => counts.set(value, (counts.get(value) ?? 0) + 1);
  const pool = filterGroups(groups, others);
  for (const group of pool) {
    if (facet === 'course') bump(String(group.courseId));
    else if (facet === 'school') bump(String(group.schoolId));
    else if (facet === 'teacher') bump(group.teacherId ? String(group.teacherId) : 'unassigned');
    else if (facet === 'status') bump(group.status);
  }
  return { counts, total: pool.length };
}

/** Matches for the current filters in the other half of the list — current or archive. */
export function countScope(groups: Group[], params: URLSearchParams, archived: boolean) {
  const scoped = new URLSearchParams(params);
  const legacyUnassigned = scoped.get('filter') === 'without-teacher';
  if (archived) scoped.set('filter', 'archive');
  else scoped.delete('filter');
  if (legacyUnassigned && !scoped.has('teacher')) scoped.set('teacher', 'unassigned');
  return filterGroups(groups, scoped).length;
}
