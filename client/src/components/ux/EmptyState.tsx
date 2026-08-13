import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { SPRING, staggerContainer, fadeInUp } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * An empty state is the one screen where an animation carries information:
 * arriving deliberately says "there is genuinely nothing here", whereas a
 * blank panel that simply appears reads as a component that failed to load.
 * The icon lands on a bounce a beat before the text, which draws the eye to
 * the call to action rather than to the absence.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <motion.div
      className={cn('flex flex-col items-center justify-center py-16 text-center', className)}
      variants={staggerContainer(0.06, 0.05)}
      initial="hidden"
      animate="visible"
    >
      <motion.div
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"
        initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={SPRING.bouncy}
      >
        <Icon className="h-7 w-7 text-muted-foreground" />
      </motion.div>
      <motion.h3 variants={fadeInUp} className="mt-4 text-base font-semibold text-foreground">
        {title}
      </motion.h3>
      {description && (
        <motion.p variants={fadeInUp} className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </motion.p>
      )}
      {action && (
        <motion.div variants={fadeInUp} className="mt-5">
          {action}
        </motion.div>
      )}
    </motion.div>
  );
}
