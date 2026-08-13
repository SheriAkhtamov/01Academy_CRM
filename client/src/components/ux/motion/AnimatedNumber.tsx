import { useEffect, useState } from 'react';
import { useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyNumber } from '@/lib/localeFormat';

type AnimatedNumberProps = {
  value: number;
  /** Own formatter — pass this for currency, percentages, compact notation. */
  format?: (value: number) => string;
  /** Fed to Intl.NumberFormat when no `format` is given. */
  formatOptions?: Intl.NumberFormatOptions;
  /** Decimals to keep while counting. Integers (0) are the common case. */
  precision?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
};

/**
 * Counts a metric up to its value on a spring instead of snapping to it.
 *
 * The spring runs on a motion value, so the count happens outside React's
 * render loop; only the formatted string is state. Under prefers-reduced-motion
 * the final value is rendered immediately — a number ticking upward is exactly
 * the kind of motion that setting exists to suppress.
 */
export function AnimatedNumber({
  value,
  format,
  formatOptions,
  precision = 0,
  className,
  prefix,
  suffix,
}: AnimatedNumberProps) {
  const { language } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const safeValue = Number.isFinite(value) ? value : 0;
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 22, mass: 0.9 });
  // Starts at zero so the first paint is the beginning of the count, not the
  // final figure flashing for one frame before the spring drags it back down.
  // Later value changes resume from wherever the spring currently sits.
  const [display, setDisplay] = useState(() => (prefersReducedMotion ? safeValue : 0));

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplay(safeValue);
      return;
    }
    motionValue.set(safeValue);
    const unsubscribe = spring.on('change', (latest) => {
      const factor = 10 ** precision;
      setDisplay(Math.round(latest * factor) / factor);
    });
    return unsubscribe;
  }, [safeValue, motionValue, spring, precision, prefersReducedMotion]);

  const rendered = format
    ? format(display)
    : formatAcademyNumber(display, language, {
      maximumFractionDigits: precision,
      minimumFractionDigits: precision,
      ...formatOptions,
    });

  return (
    <span className={className}>
      {prefix}
      {rendered}
      {suffix}
    </span>
  );
}
