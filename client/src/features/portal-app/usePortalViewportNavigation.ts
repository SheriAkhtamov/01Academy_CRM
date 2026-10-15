import { useLayoutEffect, useRef } from "react";

let viewportOwners = 0;
let previousRestoration: History["scrollRestoration"] = "auto";

const positionKey = (scope: string, location: string) =>
  `app-scroll:${scope}:${location}`;

function readPosition(key: string) {
  try {
    const position = Number(sessionStorage.getItem(key) ?? 0);
    return Number.isFinite(position) ? Math.max(0, position) : 0;
  } catch {
    return 0;
  }
}

/** Owns the learner shell document scroller. */
export function usePortalViewportNavigation({
  location,
  scope,
  onNavigate,
  ready = true,
}: {
  location: string;
  scope: string;
  onNavigate: () => void;
  ready?: boolean;
}) {
  const mainRef = useRef<HTMLElement | null>(null);
  const previous = useRef({ location, scope });
  const popTarget = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (viewportOwners === 0) previousRestoration = history.scrollRestoration;
    viewportOwners += 1;
    const documentRoot = document.documentElement;
    documentRoot.classList.add("app-shell-active");
    history.scrollRestoration = "manual";
    return () => {
      viewportOwners -= 1;
      if (viewportOwners === 0) {
        documentRoot.classList.remove("app-shell-active");
        history.scrollRestoration = previousRestoration;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const markPop = () => {
      popTarget.current = `${window.location.pathname}${window.location.search}`;
    };
    window.addEventListener("popstate", markPop);
    return () => window.removeEventListener("popstate", markPop);
  }, []);

  useLayoutEffect(() => {
    const element = mainRef.current;
    if (!element || !ready) return undefined;
    const changed =
      previous.current.location !== location ||
      previous.current.scope !== scope;
    const restore =
      changed &&
      previous.current.scope === scope &&
      popTarget.current === location;
    previous.current = { location, scope };
    popTarget.current = null;
    const key = positionKey(scope, location);
    let pendingPosition: number | null = restore ? readPosition(key) : null;
    let position = pendingPosition ?? (changed ? 0 : element.scrollTop);
    let frame = 0;
    let resize: ResizeObserver | undefined;
    let mutations: MutationObserver | undefined;
    const scrollTo = (top: number) => {
      if (typeof element.scrollTo === "function") {
        element.scrollTo({
          top,
          left: 0,
          behavior: "instant" as ScrollBehavior,
        });
      } else {
        element.scrollTop = top;
        element.scrollLeft = 0;
      }
    };

    const stopRestoring = () => {
      pendingPosition = null;
      resize?.disconnect();
      mutations?.disconnect();
    };
    const restorePosition = () => {
      if (pendingPosition === null) return;
      scrollTo(pendingPosition);
      // A cached screen can render after its loading state. Keep the saved
      // position until the content is tall enough, instead of saving a clamped 0.
      if (element.scrollTop >= pendingPosition) {
        position = element.scrollTop;
        stopRestoring();
      }
    };
    const remember = () => {
      position = pendingPosition ?? Math.round(element.scrollTop);
    };
    const takeControl = () => {
      stopRestoring();
      position = Math.round(element.scrollTop);
    };

    if (changed) {
      onNavigate();
      if (!restore) scrollTo(0);
      frame = requestAnimationFrame(() => {
        // An opened detail dialog keeps its own focus trap. Closing navigation
        // sheets explicitly hands focus to this main surface.
        if (
          !document.querySelector(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          )
        ) {
          element.focus({ preventScroll: true });
        }
        restorePosition();
      });
    }
    if (pendingPosition !== null) {
      const watchChildren = () => {
        for (const child of element.children) resize?.observe(child);
        restorePosition();
      };
      if (typeof ResizeObserver !== "undefined")
        resize = new ResizeObserver(restorePosition);
      mutations = new MutationObserver(watchChildren);
      mutations.observe(element, { childList: true, subtree: true });
      watchChildren();
    }
    element.addEventListener("scroll", remember, { passive: true });
    element.addEventListener("wheel", takeControl, { passive: true });
    element.addEventListener("touchstart", takeControl, { passive: true });
    element.addEventListener("pointerdown", takeControl);
    element.addEventListener("keydown", takeControl);
    return () => {
      cancelAnimationFrame(frame);
      stopRestoring();
      element.removeEventListener("scroll", remember);
      element.removeEventListener("wheel", takeControl);
      element.removeEventListener("touchstart", takeControl);
      element.removeEventListener("pointerdown", takeControl);
      element.removeEventListener("keydown", takeControl);
      try {
        sessionStorage.setItem(key, String(position));
      } catch {
        // Storage availability must never block navigation.
      }
    };
  }, [location, scope, onNavigate, ready]);

  return mainRef;
}
