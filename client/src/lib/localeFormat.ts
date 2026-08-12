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
