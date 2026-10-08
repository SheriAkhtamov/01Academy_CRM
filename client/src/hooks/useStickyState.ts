import { useCallback, useState } from 'react';

const STORAGE_PREFIX = 'academy-ui:';

const storageKey = (key: string) => `${STORAGE_PREFIX}${key}`;

/**
 * Component state that survives navigation and reload, backed by
 * localStorage. Reading lazily keeps tests happy; failures (private browsing,
 * quota) degrade to plain in-memory state instead of breaking the page.
 */
export function useStickyState<T>(key: string, fallback: T, normalizeStored?: (stored: unknown) => T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(key));
      if (stored === null) return fallback;
      const parsed: unknown = JSON.parse(stored);
      return normalizeStored ? normalizeStored(parsed) : parsed as T;
    } catch {
      return fallback;
    }
  });

  const update = useCallback((next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(storageKey(key), JSON.stringify(next));
    } catch {
      // Quota and privacy errors must never break the page itself.
    }
  }, [key]);

  return [value, update];
}
