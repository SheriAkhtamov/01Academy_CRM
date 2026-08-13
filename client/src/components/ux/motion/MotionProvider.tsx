import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { TRANSITION } from '@/lib/motion';

/**
 * Single place where motion is switched on for the whole app.
 *
 * `reducedMotion="user"` makes framer-motion honour the OS setting for every
 * animation in the tree: transform and layout animations are dropped while
 * opacity still cross-fades, so the UI stays legible instead of teleporting.
 * That is why no individual component needs its own prefers-reduced-motion
 * branch — only the handful that animate outside framer (a CSS keyframe, a
 * rAF loop) still check `useReducedMotion()` themselves.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={TRANSITION.base}>
      {children}
    </MotionConfig>
  );
}
