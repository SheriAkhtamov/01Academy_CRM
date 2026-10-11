import { useEffect, useState } from "react";
import { usePortal } from "./context";

/** Only navigation preferences are kept here; learning answers use server drafts. */
export function usePortalViewState<T extends Record<string, string>>(
  area: string,
  initial: T,
) {
  const { account, subject } = usePortal();
  const scope = `${account?.id}:${subject?.linkId}:${[...(subject?.permissions ?? [])].sort().join(",")}`;
  const key = `portal-view:${scope}:${area}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (
        stored &&
        typeof stored === "object" &&
        Object.keys(initial).every((field) => typeof stored[field] === "string")
      )
        return {
          ...initial,
          ...Object.fromEntries(
            Object.keys(initial).map((field) => [field, stored[field]]),
          ),
        } as T;
    } catch {
      /* A stale preference must not prevent opening a screen. */
    }
    return initial;
  });
  useEffect(() => {
    sessionStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}

export function usePortalListScroll(area: string, ready: boolean) {
  const { account, subject } = usePortal();
  const key = `portal-scroll:${account?.id}:${subject?.linkId}:${area}`;
  useEffect(() => {
    if (!ready) return;
    const saved = Number(sessionStorage.getItem(key) ?? 0);
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: Number.isFinite(saved) ? saved : 0 }),
    );
    const remember = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      remember();
      window.removeEventListener("scroll", remember);
    };
  }, [key, ready]);
}
