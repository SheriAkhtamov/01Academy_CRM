const crashReloadKey = 'academy.crm.crashReloadAt';
const crashReloadCooldownMs = 2 * 60_000;

export const mayReloadAfterCrash = (lastAttempt: number, now: number) => (
  !Number.isFinite(lastAttempt) || now - lastAttempt >= crashReloadCooldownMs
);

export function reserveCrashReload(): boolean {
  try {
    const now = Date.now();
    const lastAttempt = Number(window.sessionStorage.getItem(crashReloadKey) ?? 'NaN');
    if (!mayReloadAfterCrash(lastAttempt, now)) return false;
    window.sessionStorage.setItem(crashReloadKey, String(now));
    return true;
  } catch {
    // Without the tab-scoped guard, reloading could trap the user in a loop.
    return false;
  }
}

export function reportClientCrash(
  error: unknown,
  source: 'react-boundary' | 'module-preload',
  componentStack?: string | null,
  boundary?: 'root' | 'page' | 'widget',
) {
  if (!import.meta.env.PROD) return;
  try {
    const failure = error instanceof Error ? error : new Error(String(error));
    const body = JSON.stringify({
      source,
      boundary,
      name: failure.name.slice(0, 80),
      message: failure.message.slice(0, 500),
      stack: failure.stack?.slice(0, 3000),
      componentStack: componentStack?.slice(0, 2000),
      path: window.location.pathname.slice(0, 250),
    });
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      keepalive: true,
      body,
    }).catch(() => undefined);
  } catch {
    // Reporting must never cause another crash while React is recovering.
  }
}
