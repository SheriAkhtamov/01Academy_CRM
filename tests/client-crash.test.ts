import { afterEach, describe, expect, it, vi } from 'vitest';
import { reserveCrashReload } from '../client/src/lib/clientCrash';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('client crash recovery', () => {
  it('allows one reload, then prevents a crash loop until the cooldown ends', () => {
    const entries = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T00:00:00Z'));

    expect(reserveCrashReload()).toBe(true);
    expect(reserveCrashReload()).toBe(false);

    vi.advanceTimersByTime(2 * 60_000);
    expect(reserveCrashReload()).toBe(true);
  });

  it('does not reload when tab storage is unavailable', () => {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => { throw new Error('Storage unavailable'); },
      },
    });
    expect(reserveCrashReload()).toBe(false);
  });
});
