import { useCallback, useState } from 'react';
import { readCalendarPreference, writeCalendarPreference } from '@/lib/calendarPreferences';

/**
 * State that survives a reload. Reading lazily keeps server-rendered and test
 * environments happy, and writing on every change avoids a save button for
 * something the user expects to just stick.
 */
export function useCalendarPreference<Value extends string>(
  key: string,
  allowed: readonly Value[],
  fallback: Value,
) {
  const [value, setValue] = useState<Value>(
    () => readCalendarPreference(key, allowed, fallback),
  );

  const update = useCallback((next: Value) => {
    setValue(next);
    writeCalendarPreference(key, next);
  }, [key]);

  return [value, update] as const;
}
