import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { pageVariants } from '@/lib/motion';

type PageTransitionProps = {
  /** Changes on every navigation — this is what drives the swap. */
  routeKey: string;
  children: ReactNode;
  className?: string;
};

/**
 * Cross-fades the main content area between routes.
 *
 * `mode="wait"` keeps the two pages from overlapping, which matters here
 * because module pages own their own scroll containers and two of them on
 * screen at once fight over the viewport. The exit is deliberately much
 * shorter than the entrance (0.12s vs 0.32s) so navigation still feels
 * immediate — the wait is barely perceptible, but the swap is clean.
 */
export function PageTransition({ routeKey, children, className }: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        variants={pageVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
