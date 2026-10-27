import { forwardRef, useContext, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { motion, MotionConfigContext, useReducedMotionConfig } from 'framer-motion';
import { Button } from './button';
import { OrbitSpinner } from './orbit-spinner';
import { cn } from '@/lib/utils';

type ButtonProps = ComponentPropsWithoutRef<typeof Button>;
type CopyButtonProps = Omit<ButtonProps, 'onClick' | 'onCopy' | 'asChild'> & {
  onCopy: () => void | boolean | Promise<void | boolean>;
  /** Keep compact native buttons' existing styling instead of adding Button variants. */
  unstyled?: boolean;
  iconClassName?: string;
  iconPosition?: 'start' | 'end';
  copiedLabel?: string;
  /** Invalidate feedback and pending work when the copied value or dialog session changes. */
  resetKey?: string | number;
};

const COPY_FEEDBACK_MS = 1400;
const COPY_SPRING = { type: 'spring', stiffness: 320, damping: 24 } as const;
const FADE = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(function CopyButton({
  onCopy, unstyled = false, iconClassName, iconPosition = 'start', copiedLabel,
  resetKey, children, disabled, type = 'button', ...props
}, ref) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const lifecycle = useRef({ generation: 0, pending: false });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const reducedMotion = useReducedMotionConfig();
  const { transition } = useContext(MotionConfigContext);
  const instant = transition?.duration === 0;
  const iconTransition = instant ? { duration: 0 } : reducedMotion ? FADE : COPY_SPRING;

  useEffect(() => {
    setCopied(false);
    setPending(false);
    lifecycle.current.pending = false;
    const current = lifecycle.current;
    return () => {
      current.generation += 1;
      clearTimeout(timer.current);
    };
  }, [resetKey]);

  const copy = async () => {
    if (disabled || lifecycle.current.pending) return;
    const generation = lifecycle.current.generation;
    lifecycle.current.pending = true;
    clearTimeout(timer.current);
    setPending(true);
    setCopied(false);
    try {
      // Callers retain their scenario-specific success and error notifications.
      const result = await onCopy();
      if (generation !== lifecycle.current.generation || result === false) return;
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // A rejected action must never display a successful-copy checkmark.
    } finally {
      if (generation === lifecycle.current.generation) {
        lifecycle.current.pending = false;
        setPending(false);
      }
    }
  };

  const icon = (
    <span aria-hidden="true" className={cn('relative inline-flex size-4 shrink-0', iconClassName)}>
      {pending ? <OrbitSpinner className="absolute inset-0" style={{ width: '100%', height: '100%' }} /> : null}
      <motion.svg
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
        initial={false}
        animate={{ opacity: copied || pending ? 0 : 1, ...(reducedMotion ? {} : { scale: copied ? 0.65 : 1, rotate: copied ? -35 : 0 }) }}
        transition={iconTransition}
      >
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </motion.svg>
      <motion.svg
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
        initial={false}
        animate={{ opacity: copied ? 1 : 0, ...(reducedMotion ? {} : { scale: copied ? 1 : 0.65, rotate: copied ? 0 : 35 }) }}
        transition={iconTransition}
      >
        <path d="M5 12.5 L10 17.5 L19 7" />
      </motion.svg>
    </span>
  );

  const label = children == null ? null : copiedLabel ? (
    <span className="inline-grid min-w-0">
      <motion.span
        className="col-start-1 row-start-1"
        aria-hidden={copied}
        initial={false}
        animate={{ opacity: copied ? 0 : 1, ...(reducedMotion ? {} : { y: copied ? -4 : 0 }) }}
        transition={instant ? { duration: 0 } : FADE}
      >{children}</motion.span>
      <motion.span
        className="col-start-1 row-start-1"
        aria-hidden={!copied}
        initial={false}
        animate={{ opacity: copied ? 1 : 0, ...(reducedMotion ? {} : { y: copied ? 0 : 4 }) }}
        transition={instant ? { duration: 0 } : FADE}
      >{copiedLabel}</motion.span>
    </span>
  ) : <span className="min-w-0">{children}</span>;

  const Comp = unstyled ? 'button' : Button;
  return (
    <Comp
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-copy-state={copied ? 'copied' : 'idle'}
      onClick={() => { void copy(); }}
    >
      {iconPosition === 'start' ? icon : null}
      {label}
      {iconPosition === 'end' ? icon : null}
    </Comp>
  );
});
