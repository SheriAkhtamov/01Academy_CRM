export type ZonedDateRange = {
  start: Date;
  end: Date;
};

export type ZonedMonthRange = ZonedDateRange & {
  key: string;
};

export type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string) => {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  // Resolve options eagerly so an invalid IANA zone fails at startup/use,
  // instead of silently making business reports use the host timezone.
  formatter.resolvedOptions();
  formatterCache.set(timeZone, formatter);
  return formatter;
};

export const getZonedDateTimeParts = (instant: Date, timeZone: string): ZonedDateTimeParts => {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid date');

  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const timeZoneOffsetMs = (instant: Date, timeZone: string) => {
  const parts = getZonedDateTimeParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const instantWithoutMilliseconds = Math.floor(instant.getTime() / 1_000) * 1_000;
  return wallClockAsUtc - instantWithoutMilliseconds;
};

export const zonedWallClockToInstant = (
  parts: Pick<ZonedDateTimeParts, 'year' | 'month' | 'day'>
    & Partial<Pick<ZonedDateTimeParts, 'hour' | 'minute' | 'second'>>,
  timeZone: string,
) => {
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  let candidate = wallClockAsUtc;

  // Two passes are normally enough. Four also handles an offset transition
  // between the initial UTC guess and the resolved instant.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = wallClockAsUtc - timeZoneOffsetMs(new Date(candidate), timeZone);
    if (next === candidate) break;
    candidate = next;
  }

  return new Date(candidate);
};

const normalizedCalendarDate = (year: number, month: number, day: number) => {
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
  };
};

/**
 * Returns an exclusive business-day range in an IANA timezone. Both returned
 * Dates are UTC instants, matching how PostgreSQL `timestamp without time zone`
 * values are parsed by server/db.ts.
 */
export const getZonedDayRange = (
  reference: Date,
  timeZone: string,
  dayOffset = 0,
): ZonedDateRange => {
  const current = getZonedDateTimeParts(reference, timeZone);
  const startDate = normalizedCalendarDate(current.year, current.month, current.day + dayOffset);
  const endDate = normalizedCalendarDate(current.year, current.month, current.day + dayOffset + 1);
  return {
    start: zonedWallClockToInstant(startDate, timeZone),
    end: zonedWallClockToInstant(endDate, timeZone),
  };
};

/**
 * Converts a date-only value read from a UTC-naive PostgreSQL timestamp into
 * the matching business-calendar day. The UTC fields preserve the originally
 * selected YYYY-MM-DD even when the host process runs in another timezone.
 */
export const getZonedDateOnlyRange = (
  dateOnly: Date,
  timeZone: string,
): ZonedDateRange => {
  if (Number.isNaN(dateOnly.getTime())) throw new RangeError('Invalid date');
  const startDate = normalizedCalendarDate(
    dateOnly.getUTCFullYear(),
    dateOnly.getUTCMonth() + 1,
    dateOnly.getUTCDate(),
  );
  const endDate = normalizedCalendarDate(startDate.year, startDate.month, startDate.day + 1);
  return {
    start: zonedWallClockToInstant(startDate, timeZone),
    end: zonedWallClockToInstant(endDate, timeZone),
  };
};

/** Returns an exclusive calendar-month range and stable YYYY-MM key. */
export const getZonedMonthRange = (
  reference: Date,
  timeZone: string,
  monthOffset = 0,
): ZonedMonthRange => {
  const current = getZonedDateTimeParts(reference, timeZone);
  const startDate = normalizedCalendarDate(current.year, current.month + monthOffset, 1);
  const endDate = normalizedCalendarDate(current.year, current.month + monthOffset + 1, 1);
  return {
    start: zonedWallClockToInstant(startDate, timeZone),
    end: zonedWallClockToInstant(endDate, timeZone),
    key: `${startDate.year}-${String(startDate.month).padStart(2, '0')}`,
  };
};

/** Oldest-to-newest ranges ending with the month containing `reference`. */
export const getTrailingZonedMonthRanges = (
  reference: Date,
  timeZone: string,
  count: number,
): ZonedMonthRange[] => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Month range count must be a non-negative integer');
  }
  return Array.from({ length: count }, (_, index) =>
    getZonedMonthRange(reference, timeZone, index - count + 1));
};
