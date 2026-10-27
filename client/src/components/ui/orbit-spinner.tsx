import { forwardRef, useContext, type SVGProps } from 'react';
import { MotionConfigContext } from 'framer-motion';
import { cn } from '@/lib/utils';
import './orbit-spinner.css';

type OrbitSpinnerProps = SVGProps<SVGSVGElement> & { size?: number | string };

/** A decorative loader by default; supply a localized aria-label for a standalone status. */
export const OrbitSpinner = forwardRef<SVGSVGElement, OrbitSpinnerProps>(function OrbitSpinner({
  className, size, width, height, role, style, ...props
}, ref) {
  const config = useContext(MotionConfigContext);
  const still = config.reducedMotion === 'always' || config.transition?.duration === 0;
  const labelled = Boolean(props['aria-label'] || props['aria-labelledby']);
  const explicitSize = size !== undefined || width !== undefined || height !== undefined;
  return (
    <svg
      {...props}
      ref={ref}
      className={cn('orbit-spinner inline-block shrink-0', !explicitSize && 'size-4', className)}
      width={width ?? size ?? 24}
      height={height ?? size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      style={style}
      role={role ?? (labelled ? 'status' : undefined)}
      aria-hidden={props['aria-hidden'] ?? (labelled ? undefined : true)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <g className="orbit-spinner-orbit" style={still ? { animation: 'none' } : undefined}>
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="3" r="2" fill="currentColor" />
      </g>
    </svg>
  );
});
