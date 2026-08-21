import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { TRANSITION } from '@/lib/motion';
import { MotionPreferencesProvider, useMotionPreferences } from './MotionPreferencesProvider';

/** No duration at all — the master switch is off, so nothing should move. */
const INSTANT = { duration: 0 } as const;

/**
 * Feeds the user's own animation switch into framer's global config.
 *
 * `reducedMotion="always"` is the same lever the OS setting pulls: transform
 * and layout animation is dropped tree-wide while opacity still cross-fades,
 * so a component that was never taught about the setting still stops moving.
 * Components that *were* taught about it (see `useMotionFeature`) skip their
 * framer wrapper outright, which is where the actual CPU saving comes from.
 */
function MotionConfigBridge({ children }: { children: ReactNode }) {
  const { preferences } = useMotionPreferences();

  return (
    <MotionConfig
      reducedMotion={preferences.enabled ? 'user' : 'always'}
      transition={preferences.enabled ? TRANSITION.base : INSTANT}
    >
      {children}
    </MotionConfig>
  );
}

/**
 * Single place where motion is switched on for the whole app.
 *
 * `reducedMotion="user"` makes framer-motion honour the OS setting for every
 * animation in the tree: transform and layout animations are dropped while
 * opacity still cross-fades, so the UI stays legible instead of teleporting.
 * That is why no individual component needs its own prefers-reduced-motion
 * branch — only the handful that animate outside framer (a CSS keyframe, a
 * rAF loop) still check `useReducedMotion()` themselves.
 *
 * On top of the OS setting sits the in-app switch from Account Settings, which
 * this provider also owns; see `@/lib/motionPreferences`.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionPreferencesProvider>
      <MotionConfigBridge>{children}</MotionConfigBridge>
    </MotionPreferencesProvider>
  );
}
