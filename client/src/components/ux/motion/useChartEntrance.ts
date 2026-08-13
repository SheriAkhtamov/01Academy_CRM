import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Long enough to cover recharts' own draw, short enough to switch off before a poll lands. */
const ENTRANCE_WINDOW_MS = 1_100;

/**
 * Lets a recharts series animate its first draw and nothing after that.
 *
 * Recharts re-runs its animation whenever the `data` prop changes identity,
 * and every dashboard here polls through React Query — which hands back a new
 * array on each refetch even when the numbers are identical. Passing a plain
 * `isAnimationActive` therefore made bars and lines redraw themselves every
 * few seconds while someone was reading them, which is why the flag was
 * hardcoded to `false` across the app.
 *
 * This hook restores the entrance without the flicker: `true` while the chart
 * first paints, `false` from then on, so refetches update the geometry
 * silently. Under prefers-reduced-motion it is `false` from the start.
 *
 * ```tsx
 * const chartEntrance = useChartEntrance();
 * <Bar dataKey="leads" isAnimationActive={chartEntrance} animationDuration={700} />
 * ```
 */
export function useChartEntrance(windowMs = ENTRANCE_WINDOW_MS): boolean {
  const prefersReducedMotion = useReducedMotion();
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => setActive(false), windowMs);
    return () => window.clearTimeout(timer);
  }, [active, windowMs]);

  return prefersReducedMotion ? false : active;
}
