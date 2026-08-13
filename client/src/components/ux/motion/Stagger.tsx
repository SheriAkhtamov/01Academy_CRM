import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';
import { fadeInUp, scaleIn, staggerContainer } from '@/lib/motion';

/** Total time the whole cascade may take, however many children there are. */
const MAX_CASCADE_SECONDS = 0.42;
const BASE_STEP_SECONDS = 0.05;

type StaggerGroupProps = Omit<HTMLMotionProps<'div'>, 'variants'> & {
  children: ReactNode;
  /**
   * Number of children about to be staggered. Pass it whenever the count is
   * data-driven: the step shrinks so a 40-row table still finishes inside
   * MAX_CASCADE_SECONDS instead of trickling in for two seconds.
   */
  count?: number;
  /** Hold the cascade back, e.g. to let a page header land first. */
  delay?: number;
};

const resolveStep = (count?: number) => {
  if (!count || count <= 1) return BASE_STEP_SECONDS;
  return Math.min(BASE_STEP_SECONDS, MAX_CASCADE_SECONDS / count);
};

/**
 * Walks its `<StaggerItem>` children in one after another. Only direct
 * children inherit the cascade, so wrap the row, not the whole table body.
 */
export const StaggerGroup = forwardRef<HTMLDivElement, StaggerGroupProps>(
  ({ children, count, delay = 0, ...props }, ref) => (
    <motion.div
      ref={ref}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={staggerContainer(resolveStep(count), delay)}
      {...props}
    >
      {children}
    </motion.div>
  ),
);
StaggerGroup.displayName = 'StaggerGroup';

type StaggerItemProps = Omit<HTMLMotionProps<'div'>, 'variants'> & {
  children: ReactNode;
  /** `rise` is the default; `pop` suits tiles and metric cards. */
  preset?: 'rise' | 'pop';
  variants?: Variants;
};

export const StaggerItem = forwardRef<HTMLDivElement, StaggerItemProps>(
  ({ children, preset = 'rise', variants, ...props }, ref) => (
    <motion.div
      ref={ref}
      variants={variants ?? (preset === 'pop' ? scaleIn : fadeInUp)}
      {...props}
    >
      {children}
    </motion.div>
  ),
);
StaggerItem.displayName = 'StaggerItem';
