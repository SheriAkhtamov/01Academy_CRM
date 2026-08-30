import { normalizeWeeklySchedule } from '@shared/scheduling';
import { getZonedDateTimeParts, zonedWallClockToInstant } from './academy-time';

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type GeneratedLessonSlot = {
  lessonNumber: number;
  scheduledAt: Date;
  durationMinutes: number;
};

const normalizeCalendarDate = (date: CalendarDate, dayOffset = 0): CalendarDate => {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + dayOffset));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
};

const mondayBasedDayOfWeek = (date: CalendarDate) => {
  const nativeDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return nativeDay === 0 ? 7 : nativeDay;
};

type RecurringLessonScheduleOptions = {
  startDate: CalendarDate;
  schedule: unknown;
  lessonCount: number;
  fallbackDurationMinutes: number;
  timeZone: string;
  after?: Date;
};

const generateRecurringLessonSchedule = (
  options: RecurringLessonScheduleOptions,
): GeneratedLessonSlot[] => {
  if (!Number.isSafeInteger(options.lessonCount) || options.lessonCount < 1) return [];
  if (!Number.isFinite(options.fallbackDurationMinutes) || options.fallbackDurationMinutes < 15) return [];
  if (options.after && Number.isNaN(options.after.getTime())) return [];

  const schedule = normalizeWeeklySchedule(options.schedule, options.fallbackDurationMinutes)
    .sort((left, right) => (
      left.dayOfWeek - right.dayOfWeek
      || left.startMinutes - right.startMinutes
      || left.endMinutes - right.endMinutes
    ));
  if (schedule.length === 0) return [];

  const result: GeneratedLessonSlot[] = [];
  const maximumDays = Math.max(370, options.lessonCount * 14 + 14);

  for (let dayOffset = 0; dayOffset <= maximumDays && result.length < options.lessonCount; dayOffset += 1) {
    const calendarDate = normalizeCalendarDate(options.startDate, dayOffset);
    const dayOfWeek = mondayBasedDayOfWeek(calendarDate);
    const daySlots = schedule.filter((slot) => slot.dayOfWeek === dayOfWeek);

    for (const slot of daySlots) {
      if (result.length >= options.lessonCount) break;
      const durationMinutes = slot.endMinutes - slot.startMinutes;
      if (durationMinutes < 15) continue;
      const scheduledAt = zonedWallClockToInstant({
        ...calendarDate,
        hour: Math.floor(slot.startMinutes / 60),
        minute: slot.startMinutes % 60,
      }, options.timeZone);
      if (options.after && scheduledAt.getTime() <= options.after.getTime()) continue;
      result.push({
        lessonNumber: result.length + 1,
        scheduledAt,
        durationMinutes,
      });
    }
  }

  return result;
};

export const buildRecurringLessonSchedule = (
  options: Omit<RecurringLessonScheduleOptions, 'after'>,
): GeneratedLessonSlot[] => generateRecurringLessonSchedule(options);

/**
 * Rebuilds the remaining lesson sequence from the group's recurring timetable.
 * The one-off rescheduled lesson is an exclusive anchor: it may be on any day
 * and at any time, while the returned lessons resume at the first regular slot
 * strictly after it.
 */
export const buildFollowingRecurringLessonSchedule = (options: {
  after: Date;
  schedule: unknown;
  lessonCount: number;
  fallbackDurationMinutes: number;
  timeZone: string;
}): GeneratedLessonSlot[] => {
  if (Number.isNaN(options.after.getTime())) return [];
  const localAnchor = getZonedDateTimeParts(options.after, options.timeZone);
  return generateRecurringLessonSchedule({
    ...options,
    startDate: {
      year: localAnchor.year,
      month: localAnchor.month,
      day: localAnchor.day,
    },
  });
};
