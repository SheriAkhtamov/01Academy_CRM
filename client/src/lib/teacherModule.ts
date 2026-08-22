import type { TranslationKey } from '@/lib/i18n';
import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';

/**
 * The teacher module used to describe the same status four different ways —
 * `bg-emerald-50` in one card, `bg-emerald-500/10 dark:text-emerald-300` in a
 * modal, a raw database string in a third place. Everything a teacher screen
 * can say about a lesson, a group or a student now comes from this file, so a
 * tone is impossible to define for the light theme only and a status string
 * can never leak into the interface untranslated.
 */

export type TeacherSection = 'overview' | 'schedule' | 'groups' | 'attendance';

/** Which shelf of "My groups" is on screen: the live courses or the archive. */
export type TeacherGroupView = 'active' | 'archive';

export type TeacherLesson = {
  id: number;
  groupId: number;
  groupName?: string;
  courseId?: number;
  courseName?: string;
  teacherId?: number;
  teacherName?: string;
  schoolId?: number;
  schoolName?: string;
  lessonNumber: number;
  topic: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  groupIsArchived?: boolean;
};

export type TeacherGroupSchedule = {
  dayOfWeek: number;
  time?: string;
  startTime?: string;
  endTime?: string;
};

export type TeacherGroup = {
  id: number;
  name: string;
  courseId: number;
  courseName?: string;
  teacherId?: number;
  teacherName?: string;
  schoolId?: number;
  schoolName?: string;
  lessonCount: number;
  maxStudents: number;
  currentStudents?: number;
  capacityLabel?: string;
  schedule?: TeacherGroupSchedule[];
  status: string;
  isArchived?: boolean;
  archivedAt?: string | null;
};

export type TeacherStudent = {
  id: number;
  groupId?: number;
  groupName?: string;
  groupIds?: number[];
  groupNames?: string[];
  courseName?: string;
  studentName?: string;
  contactName: string;
  attendancePercent: number;
  progressPercent: number;
  status: string;
};

export type TeacherAttendanceRecord = {
  lessonId: number;
  studentId: number;
  status: 'present' | 'absent';
  note?: string | null;
};

export type TeacherAttendanceDraft = Record<number, 'present' | 'absent'>;

export type TeacherLessonProgress = { conducted: number; total: number };

/**
 * A shelved group is the teacher saying "I am done with this course", so its
 * lessons leave every surface that speaks about work in hand — the week, the
 * attendance calendar, today's panel, the period figures. The group's own page
 * still counts them: a progress bar that fell to zero on archiving would be a
 * lie about what was taught.
 *
 * Both sides of the check earn their place. The flag travels on the lesson, so
 * a calendar that was handed lessons alone still knows; the group ids cover a
 * dataset whose lessons predate that flag.
 */
export const lessonsOutsideArchivedGroups = <TLesson extends {
  groupId: number;
  groupIsArchived?: boolean;
}>(
  lessons: TLesson[],
  groups: Array<{ id: number; isArchived?: boolean }>,
): TLesson[] => {
  const archivedGroupIds = new Set(
    groups.filter((group) => group.isArchived).map((group) => Number(group.id)),
  );
  if (archivedGroupIds.size === 0 && !lessons.some((lesson) => lesson.groupIsArchived)) {
    return lessons;
  }
  return lessons.filter((lesson) => (
    lesson.groupIsArchived !== true && !archivedGroupIds.has(Number(lesson.groupId))
  ));
};

/**
 * Only a finished course can be shelved. `completed` is set by administration
 * when the programme actually ends, and archiving a group that still teaches
 * would hide live lessons from the calendar that exists to show them — so the
 * button is offered exactly where the server would accept it.
 */
export const canArchiveGroup = (group: { status: string; isArchived?: boolean }) => (
  !group.isArchived && group.status === 'completed'
);

/**
 * Semantic tones, not palette entries. Every tone is built from an accent at
 * low alpha plus a foreground that has an explicit dark counterpart, so a badge
 * keeps the same perceived weight in both themes instead of turning into a
 * bright patch on a dark card.
 */
/**
 * Card padding was the last unsystematised dimension in the module: four
 * different values (12 / 14 / 16 / mixed) across seven components. Two
 * constants now cover every case — dense surfaces (KPI tiles, toolbars, day
 * cells) and ordinary content cards.
 */
export const TEACHER_CARD_PADDING = 'p-4';
export const TEACHER_CARD_PADDING_DENSE = 'p-3';

export type TeacherTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export const TEACHER_TONE_CLASS = {
  neutral: 'border-border/70 bg-muted/60 text-muted-foreground',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  accent: 'border-primary/30 bg-primary/10 text-primary',
} as const satisfies Record<TeacherTone, string>;

export const TEACHER_TONE_ICON_CLASS = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-sky-500/12 text-sky-600 dark:text-sky-300',
  success: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
  warning: 'bg-amber-500/12 text-amber-600 dark:text-amber-300',
  danger: 'bg-rose-500/12 text-rose-600 dark:text-rose-300',
  accent: 'bg-primary/10 text-primary',
} as const satisfies Record<TeacherTone, string>;

export const LESSON_STATUS_TONE = {
  scheduled: 'info',
  conducted: 'success',
  cancelled: 'danger',
  postponed: 'warning',
} as const satisfies Record<string, TeacherTone>;

export const LESSON_STATUS_LABEL_KEYS = {
  scheduled: 'lessonStatusScheduled',
  conducted: 'lessonStatusConducted',
  cancelled: 'lessonStatusCancelled',
  postponed: 'lessonStatusPostponed',
} as const satisfies Record<string, TranslationKey>;

export const GROUP_STATUS_TONE = {
  open: 'info',
  in_progress: 'warning',
  completed: 'success',
} as const satisfies Record<string, TeacherTone>;

export const GROUP_STATUS_LABEL_KEYS = {
  open: 'groupStatusOpen',
  in_progress: 'groupStatusInProgress',
  completed: 'groupStatusCompleted',
} as const satisfies Record<string, TranslationKey>;

export const lessonStatusTone = (status: string): TeacherTone => (
  LESSON_STATUS_TONE[status as keyof typeof LESSON_STATUS_TONE] ?? 'neutral'
);

export const lessonStatusLabelKey = (status: string): TranslationKey | null => (
  LESSON_STATUS_LABEL_KEYS[status as keyof typeof LESSON_STATUS_LABEL_KEYS] ?? null
);

export const groupStatusTone = (status: string): TeacherTone => (
  GROUP_STATUS_TONE[status as keyof typeof GROUP_STATUS_TONE] ?? 'neutral'
);

export const groupStatusLabelKey = (status: string): TranslationKey | null => (
  GROUP_STATUS_LABEL_KEYS[status as keyof typeof GROUP_STATUS_LABEL_KEYS] ?? null
);

/** One threshold table instead of a nested ternary repeated per render. */
export const attendancePercentTone = (percent: number): TeacherTone => {
  if (percent >= 80) return 'success';
  if (percent >= 60) return 'warning';
  return 'danger';
};

/**
 * Backends disagree about weekday numbering: some send ISO 1..7 (Mon..Sun),
 * others the JavaScript 0..6 (Sun..Sat). Guessing wrong used to render a badge
 * whose weekday silently collapsed to an empty string, leaving a bare time.
 */
export const weekdayIndexFromDayOfWeek = (dayOfWeek: number): number | null => {
  if (!Number.isInteger(dayOfWeek)) return null;
  if (dayOfWeek === 0 || dayOfWeek === 7) return 6;
  if (dayOfWeek >= 1 && dayOfWeek <= 6) return dayOfWeek - 1;
  return null;
};

export const formatGroupScheduleTime = (item: TeacherGroupSchedule): string => {
  const start = item.startTime || item.time || '';
  return item.endTime && item.endTime !== start ? `${start}–${item.endTime}` : start;
};

export const getInitials = (name?: string): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

/**
 * Russian needs three forms where English needs two, so the choice belongs to
 * `Intl.PluralRules` and the dictionary — not to a ternary in JSX.
 */
export type TeacherPluralForm = 'one' | 'few' | 'many';

export const pluralForm = (count: number, locale: string): TeacherPluralForm => {
  const category = new Intl.PluralRules(locale).select(count);
  if (category === 'one') return 'one';
  if (category === 'few') return 'few';
  return 'many';
};

export const RATINGS_COUNT_KEYS = {
  one: 'ratingsCountOne',
  few: 'ratingsCountFew',
  many: 'ratingsCountMany',
} as const satisfies Record<TeacherPluralForm, TranslationKey>;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Day arithmetic runs on UTC-anchored date keys so it never drifts across a
    daylight-saving boundary in the browser's own zone. */
export const dateFromDayKey = (key: string) => new Date(`${key}T00:00:00Z`);
export const dayKeyFromDate = (date: Date) => date.toISOString().slice(0, 10);
export const shiftDayKey = (key: string, days: number) => (
  dayKeyFromDate(new Date(dateFromDayKey(key).getTime() + days * DAY_MS))
);
export const weekStartDayKey = (key: string) => (
  shiftDayKey(key, -((dateFromDayKey(key).getUTCDay() + 6) % 7))
);
export const isDayKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const academyDayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACADEMY_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Which calendar day a timestamp belongs to is an academy-local question, not a
 * UTC one: a survey left at 02:00 Tashkent time is 21:00 UTC of the previous
 * day, and grouping it by UTC put it on the wrong bar of the chart.
 */
export const academyDayKey = (value: string | number | Date): string => {
  const parts: Record<string, string> = {};
  for (const part of academyDayKeyFormatter.formatToParts(new Date(value))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const teacherPercent = (value: number, total: number) => (
  total > 0 ? Math.round((value / total) * 100) : 0
);
