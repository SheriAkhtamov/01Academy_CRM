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
        !Array.isArray(stored)
      )
        return {
          ...initial,
          ...Object.fromEntries(
            Object.keys(initial)
              .filter((field) => typeof stored[field] === "string")
              .map((field) => [field, stored[field]]),
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
