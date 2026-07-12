export type TeacherScheduleDay = {
  date: Date;
  dateKey: string;
  weekdayIndex: number;
};

type AcademyDateParts = {
  year: number;
  month: number;
  day: number;
};

function academyDateParts(value: Date, timeZone: string): AcademyDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(value)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * Produces a rolling schedule window that starts with the academy's current
 * calendar day. The dates are stored at UTC midnight strictly as date keys,
 * so formatting them in UTC keeps the school day stable in every browser.
 */
export function buildTeacherScheduleDays(
  now: Date,
  timeZone: string,
  count = 7,
): TeacherScheduleDay[] {
  const current = academyDateParts(now, timeZone);
  const firstDay = new Date(Date.UTC(current.year, current.month - 1, current.day));

  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(firstDay.getTime() + offset * 24 * 60 * 60 * 1_000);
    const dateKey = [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');

    return {
      date,
      dateKey,
      weekdayIndex: (date.getUTCDay() + 6) % 7,
    };
  });
}
