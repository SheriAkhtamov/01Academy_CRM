export interface WeeklyScheduleItemInput {
  dayOfWeek?: unknown;
  time?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  schoolId?: unknown;
}

export interface NormalizedWeeklyScheduleItem {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  schoolId: number | null;
}

export type GroupScheduleValidationError =
  | 'groupScheduleRequired'
  | 'groupScheduleInvalid'
  | 'groupScheduleOverlap';

const readScheduleArray = (value: unknown): WeeklyScheduleItemInput[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const parseScheduleTimeToMinutes = (value: unknown): number | null => {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const scheduleIntervalsOverlap = (
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) => leftStart < rightEnd && leftEnd > rightStart;

export const normalizeWeeklySchedule = (
  value: unknown,
  fallbackDurationMinutes = 60,
): NormalizedWeeklyScheduleItem[] =>
  readScheduleArray(value).flatMap((item) => {
    const dayOfWeek = Number(item.dayOfWeek);
    const startMinutes = parseScheduleTimeToMinutes(item.startTime ?? item.time);
    const parsedEnd = parseScheduleTimeToMinutes(item.endTime);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7 || startMinutes === null) {
      return [];
    }
    const endMinutes = parsedEnd === null ? startMinutes + fallbackDurationMinutes : parsedEnd;
    if (endMinutes <= startMinutes || endMinutes > 24 * 60) return [];
    const parsedSchoolId = Number(item.schoolId);
    return [{
      dayOfWeek,
      startMinutes,
      endMinutes,
      schoolId: Number.isInteger(parsedSchoolId) && parsedSchoolId > 0 ? parsedSchoolId : null,
    }];
  });

export const getGroupScheduleValidationError = (
  value: unknown,
): GroupScheduleValidationError | null => {
  const rawItems = readScheduleArray(value);
  if (rawItems.length === 0) return 'groupScheduleRequired';

  const hasInvalidInterval = rawItems.some((item) => {
    const dayOfWeek = Number(item.dayOfWeek);
    const startMinutes = parseScheduleTimeToMinutes(item.startTime ?? item.time);
    const endMinutes = parseScheduleTimeToMinutes(item.endTime);
    return !Number.isInteger(dayOfWeek)
      || dayOfWeek < 1
      || dayOfWeek > 7
      || startMinutes === null
      || endMinutes === null
      || endMinutes <= startMinutes;
  });
  if (hasInvalidInterval) return 'groupScheduleInvalid';

  const normalized = normalizeWeeklySchedule(rawItems);
  if (normalized.length !== rawItems.length) return 'groupScheduleInvalid';

  const hasOverlap = normalized.some((item, index) =>
    normalized.slice(index + 1).some((other) =>
      item.dayOfWeek === other.dayOfWeek
      && scheduleIntervalsOverlap(
        item.startMinutes,
        item.endMinutes,
        other.startMinutes,
        other.endMinutes,
      )
    )
  );
  return hasOverlap ? 'groupScheduleOverlap' : null;
};

export const weeklySchedulesOverlap = (
  left: NormalizedWeeklyScheduleItem[],
  right: NormalizedWeeklyScheduleItem[],
) => left.some((leftItem) =>
  right.some((rightItem) =>
    leftItem.dayOfWeek === rightItem.dayOfWeek
    && scheduleIntervalsOverlap(
      leftItem.startMinutes,
      leftItem.endMinutes,
      rightItem.startMinutes,
      rightItem.endMinutes,
    )
  )
);

export const scheduleDateRangesOverlap = (
  leftStart?: Date | null,
  leftEnd?: Date | null,
  rightStart?: Date | null,
  rightEnd?: Date | null,
) => {
  const leftStartTime = leftStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const leftEndTime = leftEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightStartTime = rightStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEndTime = rightEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftStartTime <= rightEndTime && leftEndTime >= rightStartTime;
};
