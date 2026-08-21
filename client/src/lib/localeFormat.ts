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
