// Load Wouter's history notifications before wrapping history. A blocked
// navigation must never be published to route subscribers.
import 'wouter/use-browser-location';

type Guard = (proceed: () => void) => void;
const guards = new Set<Guard>();
const indexKey = '__academyNavigationIndex';
let installed = false;
let bypass = false;

export function allowNavigation(action: () => void) {
  const previous = bypass;
  bypass = true;
  try { action(); } finally { bypass = previous; }
}

function lastGuard() { return Array.from(guards).at(-1); }

export function requestNavigation(action: () => void) {
  const guard = lastGuard();
  if (guard && !bypass) guard(() => allowNavigation(action));
  else allowNavigation(action);
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let index = Number(history.state?.[indexKey] ?? 0);
  let currentUrl = window.location.href;
  let restore: (() => void) | undefined;
  let approvedPop = false;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  replace({ ...history.state, [indexKey]: index }, '', currentUrl);

  const navigate = (replaceEntry: boolean, state: unknown, unused: string, url?: string | URL | null) => {
    const destination = url == null ? currentUrl : new URL(url, currentUrl).href;
    const proceed = () => {
      const nextIndex = index + (replaceEntry ? 0 : 1);
      (replaceEntry ? replace : push)({ ...(state as object), [indexKey]: nextIndex }, unused, url);
      index = nextIndex;
      currentUrl = window.location.href;
    };
    const guard = lastGuard();
    if (!bypass && destination !== currentUrl && guard) guard(() => allowNavigation(proceed));
    else proceed();
  };
  history.pushState = (state, unused, url) => navigate(false, state, unused, url);
  history.replaceState = (state, unused, url) => navigate(true, state, unused, url);

  window.addEventListener('popstate', (event) => {
    if (restore) {
      event.stopImmediatePropagation();
      const restored = restore;
      restore = undefined;
      restored();
      return;
    }
    const nextIndex = event.state?.[indexKey];
    const guard = lastGuard();
    if (!approvedPop && !bypass && guard && typeof nextIndex === 'number' && nextIndex !== index) {
      event.stopImmediatePropagation();
      const delta = nextIndex - index;
      // Restore the current entry before showing the confirmation. Cancel
      // leaves both the route and the browser's back/forward stack untouched.
      restore = () => guard(() => { approvedPop = true; history.go(delta); });
      history.go(-delta);
      return;
    }
    approvedPop = false;
    index = typeof nextIndex === 'number' ? nextIndex : index - 1;
    currentUrl = window.location.href;
  }, true);
}

export function registerNavigationGuard(guard: Guard) {
  install();
  guards.add(guard);
  return () => { guards.delete(guard); };
}

// Stamp entries before any sheet is opened, including destinations later
// reached with Back. Native document navigation is covered by beforeunload.
export function initializeNavigationGuard() { install(); }
