/**
 * Per-device switches for the animation layer.
 *
 * The CRM animates a lot — route cross-fades, staggered dashboards, FLIP
 * reflow on the kanban boards — and all of it is transform work the GPU pays
 * for. On the office machines that is free; on an older laptop the same board
 * drags. The setting therefore lives in localStorage rather than on the user
 * account: it describes the machine someone is sitting at, not who they are,
 * and the same person on a fast desktop should keep the full motion.
 *
 * Everything defaults to on, so nothing changes until someone opts out.
 */

export const MOTION_FEATURES = [
  /** Route cross-fade in the main content area. */
  'pageTransitions',
  /** Mount cascades: stagger groups, reveals, table rows, counting numbers. */
  'entrances',
  /** FLIP reflow when cards move on the lead and task boards. */
  'boardReflow',
  /** Recharts drawing its series on first paint. */
  'charts',
  /** Looping ornament: gradient text, pulse rings, floating blobs, aurora. */
  'decorative',
] as const;

export type MotionFeature = (typeof MOTION_FEATURES)[number];

export type MotionPreferences = { enabled: boolean } & Record<MotionFeature, boolean>;

export const MOTION_STORAGE_KEY = 'academy-crm-motion';

export const DEFAULT_MOTION_PREFERENCES: MotionPreferences = {
  enabled: true,
  pageTransitions: true,
  entrances: true,
  boardReflow: true,
  charts: true,
  decorative: true,
};

/** The master switch wins over every individual feature. */
export const isMotionFeatureEnabled = (
  preferences: MotionPreferences,
  feature: MotionFeature,
): boolean => preferences.enabled && preferences[feature];

const coerce = (value: unknown, fallback: boolean) => (
  typeof value === 'boolean' ? value : fallback
);

export function normalizeMotionPreferences(value: unknown): MotionPreferences {
  const source = (value ?? {}) as Partial<Record<string, unknown>>;
  const normalized = { ...DEFAULT_MOTION_PREFERENCES };

  normalized.enabled = coerce(source.enabled, DEFAULT_MOTION_PREFERENCES.enabled);
  for (const feature of MOTION_FEATURES) {
    normalized[feature] = coerce(source[feature], DEFAULT_MOTION_PREFERENCES[feature]);
  }

  return normalized;
}

export function readMotionPreferences(): MotionPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_MOTION_PREFERENCES };

  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    return stored
      ? normalizeMotionPreferences(JSON.parse(stored))
      : { ...DEFAULT_MOTION_PREFERENCES };
  } catch {
    // Private browsing and hand-edited storage both land here; full motion is
    // the safe answer because it is what the app was designed against.
    return { ...DEFAULT_MOTION_PREFERENCES };
  }
}

export function writeMotionPreferences(preferences: MotionPreferences) {
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Quota or privacy errors must never stop the switch from taking effect
    // in this session — only from surviving a reload.
  }
}

/**
 * Mirrors the preferences onto `<html>` so plain CSS can react too.
 *
 * framer-motion only knows about the components it drives; keyframes written
 * in `index.css` and the `animate-in` utilities Radix relies on are invisible
 * to it. The data attributes here are what those rules key off.
 */
export function applyMotionAttributes(preferences: MotionPreferences) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const flag = (value: boolean) => (value ? 'on' : 'off');

  root.dataset.motion = flag(preferences.enabled);
  root.dataset.motionEntrances = flag(isMotionFeatureEnabled(preferences, 'entrances'));
  root.dataset.motionDecor = flag(isMotionFeatureEnabled(preferences, 'decorative'));
}
