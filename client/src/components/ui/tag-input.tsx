import { forwardRef, useContext, type ComponentProps, type ReactNode } from 'react';
import { motion, MotionConfigContext, useIsPresent, useReducedMotion } from 'framer-motion';
import { Badge, badgeVariants } from './badge';
import { cn } from '@/lib/utils';

type TagInputTagProps = {
  children: ReactNode;
  className?: string;
  variant?: ComponentProps<typeof Badge>['variant'];
};

const SPRING = { type: 'spring', stiffness: 320, damping: 24 } as const;
const FADE = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

/** Use inside AnimatePresence; forwarding the DOM ref also supports popLayout. */
export const TagInputTag = forwardRef<HTMLDivElement, TagInputTagProps>(function TagInputTag({
  children, className, variant,
}, ref) {
  const present = useIsPresent();
  const prefersReducedMotion = useReducedMotion();
  const config = useContext(MotionConfigContext);
  const reduced = prefersReducedMotion || config.reducedMotion === 'always';
  const instant = config.transition?.duration === 0;
  const movement = !reduced && !instant;

  return (
    <motion.div
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      layout={movement ? 'position' : false}
      initial={{ opacity: 0, scale: movement ? 0.82 : 1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: movement ? 0.82 : 1 }}
      transition={instant ? { duration: 0 } : reduced ? FADE : {
        ...SPRING,
        opacity: FADE,
        layout: SPRING,
      }}
      aria-hidden={!present || undefined}
      {...(!present ? { inert: '' } : {})}
      style={{ pointerEvents: present ? undefined : 'none' }}
      onClickCapture={(event) => {
        // The removed tag remains painted during its exit, but must not accept another action.
        if (!present) { event.preventDefault(); event.stopPropagation(); }
      }}
    >
      {children}
    </motion.div>
  );
});
