import type { PublicAttendanceGroup, PublicAttendanceLesson, PublicAttendanceStatus } from '@shared/contracts/public-attendance';
import type { Language, TranslationKey } from '@/lib/i18n';
import { PublicAttendanceApiError } from './api';

export type AttendanceFilter = 'all' | 'unmarked' | 'present' | 'absent';
export type AttendanceTranslate = (key: TranslationKey) => string;
/** Where a lesson stands for the register: completed, waiting for marks, or not started yet. */
export type AttendanceLessonState = 'done' | 'open' | 'upcoming';

// The academy works in Tashkent, so "today" and every clock on the page is Tashkent time.
const TIME_ZONE = 'Asia/Tashkent';
const locale = (language: Language) => language === 'ru' ? 'ru-RU' : 'en-GB';
const format = (value: string | number | Date, language: Language, options: Intl.DateTimeFormatOptions) => (
  new Intl.DateTimeFormat(locale(language), { timeZone: TIME_ZONE, ...options }).format(new Date(value))
);

export const attendanceDay = (value: string | number | Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));

export const isAttendanceToday = (scheduledAt: string, now: number = Date.now()) => attendanceDay(scheduledAt) === attendanceDay(now);

export const attendanceDate = (value: string, language: Language, short = false) => format(value, language, {
  day: 'numeric', month: short ? 'short' : 'long', ...(short ? {} : { weekday: 'long' as const }),
});

export const attendanceTime = (value: string | Date, language: Language) => format(value, language, { hour: '2-digit', minute: '2-digit', hour12: false });

export const attendanceLessonEnd = (lesson: PublicAttendanceLesson) => new Date(new Date(lesson.scheduledAt).getTime() + lesson.durationMinutes * 60_000);

export const attendanceTimeRange = (lesson: PublicAttendanceLesson, language: Language) => (
  `${attendanceTime(lesson.scheduledAt, language)}–${attendanceTime(attendanceLessonEnd(lesson), language)}`
);

export const attendanceLessonNumber = (lesson: PublicAttendanceLesson, t: AttendanceTranslate) => (
  t('publicAttendanceLessonNumber').replace('{number}', String(lesson.number))
);

export const attendanceLessonLabel = (lesson: PublicAttendanceLesson, language: Language, t: AttendanceTranslate) => t('publicAttendanceLessonLabel')
  .replace('{number}', String(lesson.number))
  .replace('{date}', attendanceDate(lesson.scheduledAt, language, true))
  .replace('{time}', attendanceTime(lesson.scheduledAt, language));

// A fully marked lesson is done for the visitor even while the CRM waits for an earlier lesson before completing it.
export const attendanceLessonState = (lesson: PublicAttendanceLesson): AttendanceLessonState => (
  lesson.status === 'conducted' || lesson.fullyMarked ? 'done' : lesson.canMark ? 'open' : 'upcoming'
);

export const attendanceLessonStateKey = {
  done: 'publicAttendanceConducted',
  open: 'publicAttendanceAwaitingMarks',
  upcoming: 'publicAttendanceUpcoming',
} satisfies Record<AttendanceLessonState, TranslationKey>;

export type AttendanceStudentState = Exclude<PublicAttendanceStatus, null> | 'unmarked';
export const attendanceStudentState = (status: PublicAttendanceStatus): AttendanceStudentState => status ?? 'unmarked';
export const attendanceStudentStateKey = {
  present: 'publicAttendancePresent',
  absent: 'publicAttendanceAbsent',
  unmarked: 'publicAttendancePending',
} satisfies Record<AttendanceStudentState, TranslationKey>;

export const attendanceInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2)
  .map((word) => word.match(/\p{L}/u)?.[0] ?? '').join('').toLocaleUpperCase();

/*
  Codes the attendance API answers with. Only these reach the visitor as a
  message; anything else falls back to the message for the action that failed,
  so an unexpected code can never surface as raw text.
*/
const attendanceErrorKeys = [
  'publicAttendanceUnavailable', 'publicAttendanceInvalid', 'publicAttendanceWrongPassword', 'publicAttendanceAccessExpired',
  'publicAttendanceLoadFailed', 'publicAttendanceSaveFailed', 'publicAttendanceNotFound', 'publicAttendanceConflict',
  'publicAttendanceLessonNotStarted', 'publicAttendanceOffline', 'publicAttendanceTooManyAttempts',
] satisfies TranslationKey[];

/* What to say when the server gave no usable reason, per action. */
const attendanceErrorFallbacks = {
  load: 'publicAttendanceLoadFailed',
  save: 'publicAttendanceSaveFailed',
  login: 'publicAttendanceLoginFailed',
} satisfies Record<string, TranslationKey>;

/* The server reuses these codes for unrelated failures (a sign-in that could not be stored answers "save failed"); each is only shown for its own action. */
const attendanceActionCodes: Record<string, keyof typeof attendanceErrorFallbacks> = {
  publicAttendanceLoadFailed: 'load',
  publicAttendanceSaveFailed: 'save',
};

export const attendanceErrorKey = (error: unknown, action: keyof typeof attendanceErrorFallbacks): TranslationKey => {
  if (!(error instanceof PublicAttendanceApiError) || !(attendanceErrorKeys as readonly string[]).includes(error.code)) return attendanceErrorFallbacks[action];
  const owner = attendanceActionCodes[error.code];
  return owner && owner !== action ? attendanceErrorFallbacks[action] : error.code as TranslationKey;
};

/*
  The stream a visitor opens the page for is the one teaching today — the lesson
  closest to now when two streams meet on the same day — and failing that, the
  one that taught most recently.
*/
export const pickDefaultAttendanceGroup = (groups: PublicAttendanceGroup[], now: number = Date.now()) => {
  let best: { group: PublicAttendanceGroup; distance: number } | undefined;
  for (const group of groups) {
    for (const lesson of group.lessons) {
      if (!isAttendanceToday(lesson.scheduledAt, now)) continue;
      const start = new Date(lesson.scheduledAt).getTime();
      const end = attendanceLessonEnd(lesson).getTime();
      const distance = now < start ? start - now : now > end ? now - end : 0;
      if (!best || distance < best.distance) best = { group, distance };
    }
  }
  if (best) return best.group;
  let latest: { group: PublicAttendanceGroup; at: number } | undefined;
  for (const group of groups) {
    for (const lesson of group.lessons) {
      const at = new Date(lesson.scheduledAt).getTime();
      if (at <= now && (!latest || at > latest.at)) latest = { group, at };
    }
  }
  return latest?.group ?? groups[0];
};

/* The lesson on today's calendar date, even before it starts; otherwise the latest one that has started. */
export const pickDefaultAttendanceLesson = (lessons: PublicAttendanceLesson[], now: number = Date.now()) => {
  const today = lessons.find((lesson) => isAttendanceToday(lesson.scheduledAt, now));
  if (today) return today;
  const started = lessons.filter((lesson) => new Date(lesson.scheduledAt).getTime() <= now);
  return started[started.length - 1] ?? lessons[0];
};
