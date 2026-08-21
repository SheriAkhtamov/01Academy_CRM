import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  DEFAULT_MOTION_PREFERENCES,
  MOTION_FEATURES,
  applyMotionAttributes,
  isMotionFeatureEnabled,
  readMotionPreferences,
  writeMotionPreferences,
  type MotionFeature,
  type MotionPreferences,
} from '@/lib/motionPreferences';

interface MotionPreferencesState {
  preferences: MotionPreferences;
  /** Flip one switch. `enabled` is the master; the rest are per-feature. */
  setPreference: (key: 'enabled' | MotionFeature, value: boolean) => void;
  /** Back to full motion — the state the app is designed against. */
  resetPreferences: () => void;
}

const MotionPreferencesContext = createContext<MotionPreferencesState | undefined>(undefined);

export function MotionPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<MotionPreferences>(readMotionPreferences);

  // Layout effect, not effect: the attributes have to be on <html> before the
  // first paint, or a page load with animations off still flashes one frame of
  // entrance animation.
  useLayoutEffect(() => {
    applyMotionAttributes(preferences);
  }, [preferences]);

  const setPreference = useCallback((key: 'enabled' | MotionFeature, value: boolean) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      writeMotionPreferences(next);
      return next;
    });
  }, []);

  const resetPreferences = useCallback(() => {
    const next = { ...DEFAULT_MOTION_PREFERENCES };
    writeMotionPreferences(next);
    setPreferences(next);
  }, []);

  const value = useMemo(
    () => ({ preferences, setPreference, resetPreferences }),
    [preferences, setPreference, resetPreferences],
  );

  return (
    <MotionPreferencesContext.Provider value={value}>
      {children}
    </MotionPreferencesContext.Provider>
  );
}

/** For the settings UI, which has nothing to show without a real provider. */
export function useMotionPreferences(): MotionPreferencesState {
  const context = useContext(MotionPreferencesContext);
  if (!context) {
    throw new Error('useMotionPreferences must be used within a MotionProvider');
  }
  return context;
}

/**
 * Whether one kind of animation may run right now.
 *
 * Folds three answers into one boolean: the master switch, the feature switch,
 * and the operating system's own reduced-motion setting. Components call this
 * to skip the animation *and* the framer component that would drive it —
 * dropping the work entirely is the point of the setting, so leaving a
 * `motion.div` mounted with zero-length transitions would miss it.
 */
export function useMotionFeature(feature: MotionFeature): boolean {
  // Deliberately tolerant of a missing provider, unlike `useMotionPreferences`:
  // this hook sits inside widely reused components (tables, boards, counters)
  // that are also mounted on their own in tests, and the honest answer there is
  // the app's default — full motion — not a crash.
  const context = useContext(MotionPreferencesContext);
  const preferences = context?.preferences ?? DEFAULT_MOTION_PREFERENCES;
  const prefersReducedMotion = useReducedMotion();
  return !prefersReducedMotion && isMotionFeatureEnabled(preferences, feature);
}

export { MOTION_FEATURES };
export type { MotionFeature, MotionPreferences };
