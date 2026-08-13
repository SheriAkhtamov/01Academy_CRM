import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';
import { SPRING, hoverLift, scaleIn, tapScale } from '@/lib/motion';
import { cn } from '@/lib/utils';

type MotionCardProps = Omit<HTMLMotionProps<'div'>, 'variants'> & {
  children: ReactNode;
  /** Adds hover lift and press feedback. Off for cards that are pure display. */
  interactive?: boolean;
  /** Animate on mount. Leave off inside a `<StaggerGroup>`, which drives it. */
  entrance?: boolean;
};

/**
 * The card surface used by dashboards and metric tiles.
 *
 * It keeps the visual language of the plain `<Card>` — same radius, border and
 * shadow tokens — and adds a spring lift so a clickable tile reads as
 * clickable. The shadow steps up together with the lift; a card that rises
 * without its shadow following looks pasted on rather than raised.
 */
export const MotionCard = forwardRef<HTMLDivElement, MotionCardProps>(
  ({ children, interactive = false, entrance = false, className, ...props }, ref) => (
    <motion.div
      ref={ref}
      className={cn(
        'rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm',
        interactive && 'cursor-pointer hover:shadow-lg hover:border-border-strong',
        className,
      )}
      variants={entrance ? scaleIn : undefined}
      initial={entrance ? 'hidden' : undefined}
      animate={entrance ? 'visible' : undefined}
      whileHover={interactive ? hoverLift : undefined}
      whileTap={interactive ? tapScale : undefined}
      transition={SPRING.snappy}
      {...props}
    >
      {children}
    </motion.div>
  ),
);
MotionCard.displayName = 'MotionCard';
