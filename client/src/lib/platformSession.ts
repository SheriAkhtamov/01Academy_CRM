import { useSyncExternalStore } from 'react';

export type PlatformRealm = 'staff' | 'portal' | 'signed-out';

const storageKey = 'academy-platform-realm';
const listeners = new Set<() => void>();
let fallbackRealm: PlatformRealm | null = null;

export function getActivePlatformRealm(): PlatformRealm | null {
  try {
    const stored = sessionStorage.getItem(storageKey);
    return stored === 'staff' || stored === 'portal' || stored === 'signed-out' ? stored : null;
  } catch {
    return fallbackRealm;
  }
}

/** Explicit sign-out never falls through to a different surviving session cookie. */
export function setActivePlatformRealm(realm: PlatformRealm): void {
  fallbackRealm = realm;
  try {
    sessionStorage.setItem(storageKey, realm);
  } catch {
    // The in-memory realm still keeps this document's transitions consistent.
  }
  listeners.forEach((listener) => listener());
}

export function subscribePlatformRealm(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useActivePlatformRealm(): PlatformRealm | null {
  return useSyncExternalStore(subscribePlatformRealm, getActivePlatformRealm, () => null);
}
