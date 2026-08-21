import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { SPRING, listRow } from '@/lib/motion';
import { useMotionFeature } from './MotionPreferencesProvider';

type AnimatedListProps = {
  children: ReactNode;
  /**
   * `sync` (default) lets rows leave and arrive at once — right for a list
   * that reorders. `popLayout` pulls the leaving row out of flow first, so the
   * survivors close the gap while it fades; use it for delete/archive.
   */
  mode?: 'sync' | 'popLayout' | 'wait';
  /** Skip the entrance for rows present on first paint. */
  animateInitial?: boolean;
};

/**
 * Gives a collection real exit animations.
 *
 * Without AnimatePresence a removed row simply vanishes and everything below
 * jumps up — the single most jarring thing in a CRM, because rows disappear
 * constantly (archive a lead, resolve a task, filter a table). Someone who has
 * turned board reflow off has accepted that jump in exchange for the frames.
 */
export function AnimatedList({ children, mode = 'sync', animateInitial = false }: AnimatedListProps) {
  const animated = useMotionFeature('boardReflow');

  if (!animated) return <>{children}</>;

  return (
    <AnimatePresence mode={mode} initial={animateInitial}>
      {children}
    </AnimatePresence>
  );
}

type AnimatedListItemProps = Omit<HTMLMotionProps<'div'>, 'variants'> & {
  children: ReactNode;
  /** Enables FLIP reflow when siblings are added, removed or reordered. */
  reflow?: boolean;
};

/**
 * A row inside `<AnimatedList>`. Needs a stable `key` from the caller —
 * an index key makes every row below a deletion animate as if it changed.
 */
export const AnimatedListItem = forwardRef<HTMLDivElement, AnimatedListItemProps>(
  ({ children, reflow = true, ...props }, ref) => {
    const animated = useMotionFeature('boardReflow');

    if (!animated) {
      return <div ref={ref} {...(props as unknown as HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    }

    return (
      <motion.div
        ref={ref}
        layout={reflow ? 'position' : false}
        variants={listRow}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={SPRING.layout}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);
AnimatedListItem.displayName = 'AnimatedListItem';
