import { DEFAULT_ACADEMY_TIME_ZONE } from '@shared/scheduling';

export const ACADEMY_TIME_ZONE = DEFAULT_ACADEMY_TIME_ZONE;

/**
 * Formats must follow the language the user picked in the app, not a hardcoded
 * one and not the browser's. Several screens used to print Russian month and
 * weekday names inside an otherwise English UI, and task cards followed the
 * browser locale, so their dates disagreed with every other screen.
 */
export const resolveLocale = (language: string) => (language === 'ru' ? 'ru-RU' : 'en-US');

/** Times are academy-local; see DEFAULT_ACADEMY_TIME_ZONE for why. */
export const academyDateTimeFormat = (
  language: string,
  options: Intl.DateTimeFormatOptions = {},
) => new Intl.DateTimeFormat(resolveLocale(language), {
  timeZone: ACADEMY_TIME_ZONE,
  ...options,
});

export const formatAcademyDate = (
  value: Date | string | number | null | undefined,
  language: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
) => {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return academyDateTimeFormat(language, options).format(date);
};

export const formatAcademyNumber = (
  value: number | string | null | undefined,
  language: string,
  options: Intl.NumberFormatOptions = {},
) => new Intl.NumberFormat(resolveLocale(language), options).format(Number(value ?? 0) || 0);

const academyDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACADEMY_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * `yyyy-MM-dd` for `<input type="date">`, read in academy time.
 *
 * Screens used to build this three different ways: `toISOString()` (UTC), and
 * `getTimezoneOffset()` (whatever zone the laptop is in). Both drift a day away
 * from the academy calendar — UTC does it every night between 00:00 and 05:00
 * local, and for any timestamp stored with a `+05:00` offset — so a date field
 * would open on yesterday. Every date field reads the same clock now.
 */
export const academyDateInputValue = (value: Date | string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts: Record<string, string> = {};
  for (const part of academyDateKeyFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Today's `yyyy-MM-dd` in academy time. */
export const academyToday = () => academyDateInputValue(new Date());

/** Asia/Tashkent observes no daylight saving, so its offset is a constant. */
export const ACADEMY_UTC_OFFSET = '+05:00';

/** An instant from an academy wall clock: `yyyy-MM-dd` plus `HH:mm`. */
export const academyInstant = (dateKey: string, time = '00:00') => (
  new Date(`${dateKey}T${time}:00${ACADEMY_UTC_OFFSET}`)
);

const academyTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ACADEMY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `HH:mm` on the academy clock; the inverse of `academyInstant`. */
export const academyTimeOfDay = (value: Date | string | number) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : academyTimeFormatter.format(date);
};

const academyMinutesFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ACADEMY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Minutes since midnight on the academy clock for an instant.
 *
 * Schedule grids must position booked lessons with this instead of
 * `Date.getHours()` — the browser-local getter shifts lessons when the device
 * is not in the academy time zone and misaligns them against recurring
 * timetable slots rendered from wall-clock numbers.
 */
export const academyMinutesOfDay = (value: Date | string | number) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const parts: Record<string, string> = {};
  for (const part of academyMinutesFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return Number(parts.hour) % 24 * 60 + Number(parts.minute);
};

/**
 * A pseudo-instant whose *browser-local* wall clock reads the academy clock.
 *
 * Display-only shim for legacy math that reads local getters directly
 * (`getHours()`, `isSameDay()`): schedule grids can treat it as "now" and stay
 * on the academy clock on any device. Real instants must go through the
 * Intl formatters above or `academyInstant`.
 */
export const academyNowLocalView = () => {
  const now = new Date();
  return new Date(`${academyDateInputValue(now)}T${academyTimeOfDay(now)}:00`);
};
