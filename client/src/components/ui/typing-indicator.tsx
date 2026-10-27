import { forwardRef, useCallback, useContext, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { MotionConfigContext } from 'framer-motion';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import './typing-indicator.css';

type TypingIndicatorProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  active?: boolean;
};

/** Show only while a participant is actually composing a message. */
export const TypingIndicator = forwardRef<HTMLSpanElement, TypingIndicatorProps>(function TypingIndicator({
  active = true, className, 'aria-label': label, ...props
}, forwardedRef) {
  const { t } = useTranslation();
  const config = useContext(MotionConfigContext);
  const still = config.reducedMotion === 'always' || config.transition?.duration === 0;
  const element = useRef<HTMLSpanElement | null>(null);
  const [paused, setPaused] = useState(false);
  const ref = useCallback((node: HTMLSpanElement | null) => {
    element.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useEffect(() => {
    if (!active || !element.current) return;
    let inView = true;
    const update = () => setPaused(document.hidden || !inView);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer?.observe(element.current);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [active]);

  if (!active) return null;
  const accessibleLabel = label ?? t('chatTyping');
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      {...props}
      ref={ref}
      aria-label={accessibleLabel}
      className={cn('typing-indicator inline-flex h-6 shrink-0 items-center gap-1 align-middle', className)}
      data-typing-motion={still ? 'off' : 'on'}
      data-typing-paused={paused}
    >
      <span className="sr-only">{accessibleLabel}</span>
      <span className="typing-indicator-dot" aria-hidden="true" />
      <span className="typing-indicator-dot" aria-hidden="true" />
      <span className="typing-indicator-dot" aria-hidden="true" />
    </span>
  );
});
