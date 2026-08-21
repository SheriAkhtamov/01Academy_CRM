import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import {
  REVEAL_VIEWPORT,
  fadeInLeft,
  fadeInRight,
  fadeInUp,
  scaleIn,
} from '@/lib/motion';
import { useMotionFeature } from './MotionPreferencesProvider';

const PRESETS = {
  up: fadeInUp,
  left: fadeInLeft,
  right: fadeInRight,
  scale: scaleIn,
} as const;

type RevealProps = Omit<HTMLMotionProps<'div'>, 'variants'> & {
  children: ReactNode;
  from?: keyof typeof PRESETS;
  delay?: number;
};

/**
 * Animates its content the first time it scrolls into view.
 *
 * Meant for long dashboard columns where a single mount-time cascade would
 * have already finished by the time the operator scrolls down to the charts.
 * Fires once — re-animating on every scroll past is distracting in a tool.
 *
 * With entrances off there is no intersection observer at all, which matters
 * on a dashboard that holds a dozen of these.
 */
export const Reveal = forwardRef<HTMLDivElement, RevealProps>(
  ({ children, from = 'up', delay = 0, transition, ...props }, ref) => {
    const animated = useMotionFeature('entrances');

    if (!animated) {
      return <div ref={ref} {...(props as unknown as HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    }

    return (
      <motion.div
        ref={ref}
        initial="hidden"
        whileInView="visible"
        viewport={REVEAL_VIEWPORT}
        variants={PRESETS[from]}
        transition={delay ? { delay, ...transition } : transition}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);
Reveal.displayName = 'Reveal';
