import { useEffect, useState } from 'react';

/**
 * Calendars need the real viewport, not a CSS breakpoint: a week grid has to
 * become an agenda on a phone rather than hide behind horizontal scroll, and
 * that decision drives which data the component builds, not just how it paints.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}

/**
 * Below Tailwind's `lg` breakpoint a seven-column grid stops being usable.
 * Phrased as a max-width so environments without `matchMedia` (jsdom) fall back
 * to the roomy layout rather than to the phone one.
 */
export const useIsCompactViewport = () => useMediaQuery('(max-width: 1023px)');

/**
 * Phone-sized: everything below Tailwind's `md`, which is where the app shell
 * folds the sidebar into a drawer. Layouts that only need to *paint*
 * differently should use the `md:` prefix instead — this hook is for the cases
 * where the component has to build something else entirely, such as a table
 * that becomes a list of cards.
 */
export const useIsMobileViewport = () => useMediaQuery('(max-width: 767px)');

/**
 * A coarse pointer means no hover state to lean on and a ~44px finger instead
 * of a ~2px cursor: affordances that only appear on hover have to stay visible,
 * and drag handles have to be big enough to grab.
 */
export const useIsTouchPointer = () => useMediaQuery('(pointer: coarse)');
