import type { Transition, Variants } from 'framer-motion';

/**
 * Motion design tokens.
 *
 * The CRM is a tool people sit in for eight hours, so every value here is
 * tuned to be *expressive but short*: entrances read as deliberate, yet nothing
 * makes the operator wait. Anything above ~0.4s belongs to a full-surface
 * transition (sheet, page), never to a control the user just clicked.
 *
 * Reduced motion is handled globally by `<MotionProvider>` (framer-motion's
 * MotionConfig with reducedMotion="user"), which strips transform/layout
 * animation while keeping opacity — so nothing here needs its own guard.
 */

/** Duration ladder, in seconds. */
export const DURATION = {
  /** Colour/opacity flips that must feel instantaneous. */
  instant: 0.12,
  /** Hover, focus, small state changes. */
  fast: 0.18,
  /** The workhorse: cards, list rows, popovers. */
  base: 0.24,
  /** Page and panel entrances. */
  slow: 0.32,
  /** Large surfaces only (sheet, drawer). */
  slowest: 0.42,
} as const;

/**
 * Cubic-bezier curves as fixed 4-tuples — framer-motion rejects a plain
 * `number[]` at the type level, so the tuple annotation is load-bearing.
 */
type Bezier = [number, number, number, number];

export const EASE = {
  /** Strong decelerate. Default for anything entering the screen. */
  out: [0.16, 1, 0.3, 1] as Bezier,
  /** Accelerate away. Exits only — an entrance on this curve feels sluggish. */
  in: [0.7, 0, 0.84, 0] as Bezier,
  /** Symmetric. Position changes where both ends are on screen. */
  inOut: [0.65, 0, 0.35, 1] as Bezier,
  /** Slight overshoot. Reserved for pops: badges, counters, confirmations. */
  overshoot: [0.34, 1.56, 0.64, 1] as Bezier,
} as const;

/**
 * Spring presets. Springs are used where the end position is data-driven
 * (layout reflow, drag, toggles) and a fixed duration would look mechanical.
 */
export const SPRING = {
  /** Near-critically damped. Buttons, switches, tab indicators. */
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  /** Default for layout reflow — kanban cards, reordering lists. */
  layout: { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 },
  /** Softer and heavier, for large surfaces. */
  gentle: { type: 'spring', stiffness: 260, damping: 30, mass: 1 },
  /** Visible bounce. Celebratory only: new lead landed, payment received. */
  bouncy: { type: 'spring', stiffness: 440, damping: 17, mass: 0.8 },
} satisfies Record<string, Transition>;

/** Ready-made transitions for the common cases. */
export const TRANSITION = {
  fast: { duration: DURATION.fast, ease: EASE.out },
  base: { duration: DURATION.base, ease: EASE.out },
  slow: { duration: DURATION.slow, ease: EASE.out },
  exit: { duration: DURATION.fast, ease: EASE.in },
  pop: { duration: DURATION.base, ease: EASE.overshoot },
} satisfies Record<string, Transition>;

/* ------------------------------------------------------------------ *
 * Variants
 * ------------------------------------------------------------------ */

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TRANSITION.base },
  exit: { opacity: 0, transition: TRANSITION.exit },
};

/** The default entrance: rise a little while fading in. */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: TRANSITION.base },
  exit: { opacity: 0, y: -8, transition: TRANSITION.exit },
};

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: { opacity: 1, y: 0, transition: TRANSITION.base },
  exit: { opacity: 0, y: 8, transition: TRANSITION.exit },
};

export const fadeInLeft: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: TRANSITION.base },
  exit: { opacity: 0, x: -12, transition: TRANSITION.exit },
};

export const fadeInRight: Variants = {
  hidden: { opacity: 0, x: 16 },
  visible: { opacity: 1, x: 0, transition: TRANSITION.base },
  exit: { opacity: 0, x: 12, transition: TRANSITION.exit },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: TRANSITION.base },
  exit: { opacity: 0, scale: 0.97, transition: TRANSITION.exit },
};

/** Overshoots on the way in — for things that should feel like they "land". */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: TRANSITION.pop },
  exit: { opacity: 0, scale: 0.85, transition: TRANSITION.exit },
};

/**
 * A row in a live collection. Collapsing the height on exit is what stops the
 * list from snapping shut when an item is archived or deleted.
 */
export const listRow: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: TRANSITION.base },
  exit: {
    opacity: 0,
    x: -24,
    height: 0,
    marginTop: 0,
    marginBottom: 0,
    transition: { duration: DURATION.fast, ease: EASE.in },
  },
};

/** Page-level entrance used by the route transition. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE.out } },
  exit: { opacity: 0, y: -6, transition: { duration: DURATION.instant, ease: EASE.in } },
};

/**
 * Parent variant that walks its children in one at a time.
 *
 * Keep `stagger` small and cap the number of staggered children: at 0.05s a
 * 40-row table would take two seconds to finish drawing, which reads as lag,
 * not polish. `<StaggerGroup>` enforces the cap for you.
 */
export const staggerContainer = (stagger = 0.045, delayChildren = 0): Variants => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren },
  },
  exit: {
    transition: { staggerChildren: 0.02, staggerDirection: -1 },
  },
});

/** Shared `whileInView` config — fire once, slightly before the edge. */
export const REVEAL_VIEWPORT = { once: true, amount: 0.15, margin: '0px 0px -60px 0px' } as const;

/* ------------------------------------------------------------------ *
 * Interaction presets
 * ------------------------------------------------------------------ */

/** Press feedback for buttons and other small controls. */
export const tapScale = { scale: 0.97 } as const;

/** Hover lift for cards. Pairs with a shadow class on the element itself. */
export const hoverLift = { y: -4, transition: TRANSITION.fast } as const;

/** Hover response for a dense row, where a 4px lift would look broken. */
export const hoverNudge = { x: 2, transition: TRANSITION.fast } as const;
