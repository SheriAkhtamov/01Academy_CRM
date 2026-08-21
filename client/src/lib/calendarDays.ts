/**
 * Day arithmetic for every calendar grid in the app.
 *
 * Keys are `yyyy-MM-dd` and every `Date` built here is anchored at UTC
 * midnight, so stepping a week or a month never drifts across a daylight-saving
 * boundary in whatever zone the browser happens to be in. Which calendar day a
 * timestamp belongs to is a separate question, answered by
 * `academyDateInputValue` — that one reads the academy clock.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CalendarDay {
  date: Date;
  dateKey: string;
  isCurrentMonth: boolean;
}

export const dateFromDayKey = (key: string) => new Date(`${key}T00:00:00Z`);

export const dayKeyFromDate = (date: Date) => date.toISOString().slice(0, 10);

export const isDayKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const shiftDayKey = (key: string, days: number) => (
  dayKeyFromDate(new Date(dateFromDayKey(key).getTime() + days * DAY_MS))
);

/** Weeks start on Monday everywhere in the product. */
export const weekStartDayKey = (key: string) => (
  shiftDayKey(key, -((dateFromDayKey(key).getUTCDay() + 6) % 7))
);

export const shiftMonthKey = (key: string, offset: number) => {
  const date = dateFromDayKey(key);
  return dayKeyFromDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)));
};

/** Whole weeks covering the anchor's month, so the grid is always 7 wide. */
export const buildMonthDays = (anchorKey: string): CalendarDay[] => {
  const anchor = dateFromDayKey(anchorKey);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const leadingDays = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - leadingDays + 1));
    return {
      date,
      dateKey: dayKeyFromDate(date),
      isCurrentMonth: date.getUTCMonth() === month,
    };
  });
};

export const buildWeekDays = (anchorKey: string): CalendarDay[] => {
  const start = weekStartDayKey(anchorKey);
  return Array.from({ length: 7 }, (_, index) => {
    const dateKey = shiftDayKey(start, index);
    return { date: dateFromDayKey(dateKey), dateKey, isCurrentMonth: true };
  });
};
