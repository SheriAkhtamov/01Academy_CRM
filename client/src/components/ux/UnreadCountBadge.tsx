import { AnimatePresence, motion } from 'framer-motion';
import { SPRING, TRANSITION } from '@/lib/motion';
import { cn } from '@/lib/utils';

type UnreadCountBadgeProps = {
  count: number;
  label: string;
  announce?: boolean;
  className?: string;
};

export const formatUnreadCount = (count: number): string => {
  const normalizedCount = Number.isFinite(count)
    ? Math.max(0, Math.trunc(count))
    : 0;
  return normalizedCount > 99 ? '99+' : String(normalizedCount);
};

const badgeClassName = 'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold leading-none tabular-nums text-destructive-foreground shadow-sm ring-2 ring-background';

/**
 * The bubble springs in when work arrives and shrinks away when the queue is
 * cleared. `key={count}` is deliberate: re-keying on the number makes framer
 * treat every increment as a new element, so the badge re-pops each time a
 * lead or missed call lands — that pop is the notification.
 */
const AnimatedBubble = ({
  count,
  label,
  className,
  hidden,
}: {
  count: number;
  label?: string;
  className?: string;
  hidden?: boolean;
}) => (
  <AnimatePresence initial={false} mode="popLayout">
    {count > 0 ? (
      <motion.span
        key={count}
        aria-label={hidden ? undefined : label}
        aria-hidden={hidden ? 'true' : undefined}
        className={cn(badgeClassName, className)}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0, transition: TRANSITION.exit }}
        transition={SPRING.bouncy}
      >
        {formatUnreadCount(count)}
      </motion.span>
    ) : null}
  </AnimatePresence>
);

export function UnreadCountBadge({
  count,
  label,
  announce = false,
  className,
}: UnreadCountBadgeProps) {
  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

  if (!announce) {
    return <AnimatedBubble count={normalizedCount} label={label} className={className} />;
  }

  // A live region only announces updates that happen while it is already in the
  // DOM. Unmounting the badge at zero meant the region was inserted together
  // with its text and screen readers stayed silent, so keep it mounted always
  // and let the visible bubble come and go instead.
  return (
    <>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {normalizedCount > 0 ? label : ''}
      </span>
      <AnimatedBubble count={normalizedCount} className={className} hidden />
    </>
  );
}
