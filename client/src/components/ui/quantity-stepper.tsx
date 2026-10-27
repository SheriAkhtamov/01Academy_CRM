import {
  forwardRef, useContext, useEffect, useId, useRef, useState,
  type ComponentPropsWithoutRef,
} from 'react';
import { AnimatePresence, motion, MotionConfigContext, useReducedMotionConfig } from 'framer-motion';
import { Input } from './input';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

type QuantityStepperProps = Omit<ComponentPropsWithoutRef<typeof Input>, 'type'> & {
  type?: 'number';
};

const SPRING = { type: 'spring', stiffness: 320, damping: 24 } as const;
const FADE = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;
const BUTTON_CLASS = 'absolute inset-y-0 flex w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const QuantityStepper = forwardRef<HTMLInputElement, QuantityStepperProps>(function QuantityStepper({
  value, defaultValue, min, max, step, disabled, readOnly, className, style,
  onChange, onFocus, onBlur, type: _type, ...props
}, ref) {
  const { t, language } = useTranslation();
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const input = useRef<HTMLInputElement | null>(null);
  const [localValue, setLocalValue] = useState(String(defaultValue ?? ''));
  const [focused, setFocused] = useState(false);
  const [direction, setDirection] = useState(1);
  const [fieldLabel, setFieldLabel] = useState('');
  const reducedMotion = useReducedMotionConfig();
  const { transition } = useContext(MotionConfigContext);
  const instant = transition?.duration === 0;
  const displayedValue = String(value ?? localValue);
  const showAnimatedValue = !focused && displayedValue !== '';
  const number = displayedValue === '' ? NaN : Number(displayedValue);
  const blocked = Boolean(disabled || readOnly);
  const accessibleLabel = props['aria-label'];
  const labelledByIds = props['aria-labelledby'];

  useEffect(() => {
    const labelledBy = labelledByIds?.split(/\s+/)
      .map((labelId) => document.getElementById(labelId)?.textContent ?? '').join(' ');
    const label = accessibleLabel || labelledBy || Array.from(input.current?.labels ?? [])
      .map((element) => element.textContent ?? '').join(' ');
    setFieldLabel(label.trim().replace(/\s*\*$/, ''));
  }, [id, accessibleLabel, labelledByIds, language]);

  useEffect(() => {
    const form = input.current?.form;
    const afterReset = () => queueMicrotask(() => {
      if (input.current) setLocalValue(input.current.value);
    });
    form?.addEventListener('reset', afterReset);
    return () => form?.removeEventListener('reset', afterReset);
  }, [props.form]);

  const change = (nextDirection: number) => {
    const element = input.current;
    if (!element || blocked || element.matches(':disabled')) return;
    const previous = element.value;
    // Native stepping preserves the field's step lattice, decimal precision and bounds.
    // It bypasses React's value tracker, so the input event reaches onChange and RHF.
    if (nextDirection > 0) element.stepUp();
    else element.stepDown();
    if (element.value === previous) return;
    setDirection(nextDirection);
    setLocalValue(element.value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const actionButton = (buttonDirection: -1 | 1) => {
    const decrease = buttonDirection === -1;
    const atBound = decrease
      ? min !== undefined && min !== '' && number <= Number(min)
      : max !== undefined && max !== '' && number >= Number(max);
    const action = decrease ? t('quantityDecrease') : t('quantityIncrease');
    return (
      <motion.button
        type="button"
        className={cn(BUTTON_CLASS, decrease ? 'left-0' : 'right-0')}
        disabled={blocked || atBound}
        aria-label={fieldLabel ? `${action}: ${fieldLabel}` : action}
        aria-controls={id}
        whileTap={reducedMotion || instant ? undefined : { scale: 0.88 }}
        transition={instant ? { duration: 0 } : SPRING}
        onClick={() => change(buttonDirection)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
          <path d="M5 12h14" />
          {!decrease ? <path d="M12 5v14" /> : null}
        </svg>
      </motion.button>
    );
  };

  return (
    <div data-error-shake-control className="quantity-stepper relative min-w-0 text-base md:text-sm">
      <Input
        {...props}
        id={id}
        ref={(node) => {
          input.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="number"
        {...(value !== undefined ? { value } : defaultValue !== undefined ? { defaultValue } : {})}
        min={min} max={max} step={step} disabled={disabled} readOnly={readOnly}
        className={cn('px-10 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', className)}
        style={{ ...style, ...(showAnimatedValue ? { color: 'transparent' } : {}) }}
        onChange={(event) => {
          setDirection(Number(event.target.value) < number ? -1 : 1);
          setLocalValue(event.target.value);
          onChange?.(event);
        }}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      />
      {showAnimatedValue ? (
        <span aria-hidden="true" className={cn('pointer-events-none absolute inset-y-0 left-10 right-10 grid items-center justify-items-center overflow-hidden tabular-nums', disabled && 'opacity-50')}>
          {instant ? <span className="max-w-full truncate">{displayedValue}</span> : <AnimatePresence initial={false} custom={direction}>
            <motion.span
              key={displayedValue}
              custom={direction}
              className="col-start-1 row-start-1 max-w-full truncate"
              variants={{
                enter: (dir: number) => ({ opacity: 0, y: reducedMotion ? 0 : dir * 8, scale: reducedMotion ? 1 : 0.9 }),
                visible: { opacity: 1, y: 0, scale: 1 },
                exit: (dir: number) => ({ opacity: 0, y: reducedMotion ? 0 : dir * -8, scale: reducedMotion ? 1 : 0.9 }),
              }}
              initial="enter" animate="visible" exit="exit"
              transition={instant ? { duration: 0 } : reducedMotion ? FADE : { ...SPRING, opacity: FADE }}
            >{displayedValue}</motion.span>
          </AnimatePresence>}
        </span>
      ) : null}
      {actionButton(-1)}
      {actionButton(1)}
    </div>
  );
});
