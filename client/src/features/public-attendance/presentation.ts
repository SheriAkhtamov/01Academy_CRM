import type { PublicAttendanceLesson } from '@shared/contracts/public-attendance';
import type { Language, TranslationKey } from '@/lib/i18n';

export type AttendanceFilter = 'all' | 'unmarked' | 'present' | 'absent';
export type AttendanceTranslate = (key: TranslationKey) => string;
const locale = (language: Language) => language === 'ru' ? 'ru-RU' : 'en-GB';

export const attendanceDate = (value: string, language: Language, short = false) => new Intl.DateTimeFormat(locale(language), {
  timeZone: 'Asia/Tashkent', day: 'numeric', month: short ? 'short' : 'long',
  ...(short ? {} : { weekday: 'long' as const }),
}).format(new Date(value));

export const attendanceTime = (value: string, language: Language) => new Intl.DateTimeFormat(locale(language), {
  timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));

/*
  The lesson strip labels a date the way a person reads a calendar cell: the
  weekday first, then the day, then a short month — "ср, 7 окт.". `attendanceDate`
  stays as it is because the lesson's accessible name is built from it, and the
  list of lessons in the phone's picker reads better with a long month.
*/
export const attendanceWeekdayDate = (value: string, language: Language) => new Intl.DateTimeFormat(locale(language), {
  timeZone: 'Asia/Tashkent', weekday: 'short', day: 'numeric', month: 'short',
}).format(new Date(value));

export const attendanceWeekday = (value: string, language: Language) => new Intl.DateTimeFormat(locale(language), {
  timeZone: 'Asia/Tashkent', weekday: 'short',
}).format(new Date(value));

/*
  A calendar leaf needs the day and the month as two separate lines, so they are
  formatted separately rather than sliced out of one string: "окт." and "7".
*/
export const attendanceDayNumber = (value: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tashkent', day: 'numeric',
}).format(new Date(value));

export const attendanceMonthShort = (value: string, language: Language) => new Intl.DateTimeFormat(locale(language), {
  timeZone: 'Asia/Tashkent', month: 'short',
}).format(new Date(value));

export const attendanceTimeRange = (lesson: PublicAttendanceLesson, language: Language) => `${attendanceTime(lesson.scheduledAt, language)}–${attendanceTime(new Date(new Date(lesson.scheduledAt).getTime() + lesson.durationMinutes * 60000).toISOString(), language)}`;

export const attendanceLessonLabel = (lesson: PublicAttendanceLesson, language: Language, t: AttendanceTranslate) => t('publicAttendanceLessonLabel')
  .replace('{number}', String(lesson.number))
  .replace('{date}', attendanceDate(lesson.scheduledAt, language, true))
  .replace('{time}', attendanceTime(lesson.scheduledAt, language));

export const attendanceLessonCount = (count: number, language: Language, t: AttendanceTranslate) => {
  const plural = new Intl.PluralRules(locale(language)).select(count);
  const label = plural === 'one' ? t('publicAttendanceLessonsOne') : plural === 'few' ? t('publicAttendanceLessonsFew') : t('publicAttendanceLessonsMany');
  return label.replace('{count}', String(count));
};

export const isAttendanceToday = (scheduledAt: string) => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' });
  return day.format(new Date(scheduledAt)) === day.format(new Date());
};

export const attendanceInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2)
  .map((word) => word.match(/\p{L}/u)?.[0] ?? '').join('').toLocaleUpperCase();
