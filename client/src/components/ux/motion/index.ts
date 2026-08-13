/**
 * Shared motion layer. Every animated surface in the app is built from these
 * primitives so timing, easing and reduced-motion behaviour stay consistent —
 * the tokens they read from live in `@/lib/motion`.
 */
export { MotionProvider } from './MotionProvider';
export { PageTransition } from './PageTransition';
export { StaggerGroup, StaggerItem } from './Stagger';
export { AnimatedList, AnimatedListItem } from './AnimatedList';
export { AnimatedNumber } from './AnimatedNumber';
export { Reveal } from './Reveal';
export { MotionCard } from './MotionCard';
export { useChartEntrance } from './useChartEntrance';
