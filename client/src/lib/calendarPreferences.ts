/**
 * View choices (week vs day, filter panel open or closed) are personal and
 * change rarely. Losing them on every reload made every calendar feel amnesiac
 * — a manager who works in the agenda had to re-pick it a dozen times a day —
 * so they are stored per surface instead of living in component state only.
 */
const STORAGE_PREFIX = 'academy-calendar:';

export type CalendarViewMode = 'day' | 'week' | 'month' | 'agenda';

export const CALENDAR_VIEW_MODES = ['day', 'week', 'month', 'agenda'] as const;

const storageKey = (key: string) => `${STORAGE_PREFIX}${key}`;

export function readCalendarPreference<Value extends string>(
  key: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  try {
    const stored = window.localStorage.getItem(storageKey(key));
    return allowed.includes(stored as Value) ? (stored as Value) : fallback;
  } catch {
    // Private browsing throws on access; a default view is a fine outcome.
    return fallback;
  }
}

export function writeCalendarPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(storageKey(key), value);
  } catch {
    // Quota and privacy errors must never break the calendar itself.
  }
}
