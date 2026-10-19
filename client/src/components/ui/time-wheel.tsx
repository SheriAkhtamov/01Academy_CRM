import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const ROW_HEIGHT = 44;

export type TimeWheelHandle = { getValue: () => number };

export const TimeWheel = forwardRef<TimeWheelHandle, {
  label: string;
  value: number;
  options: number[];
  onValueChange: (value: number) => void;
}>(function TimeWheel({ label, value, options, onValueChange }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const change = useRef(onValueChange);
  change.current = onValueChange;
  const index = options.indexOf(value);
  // Read the visible selection when confirming during a touch scroll, before
  // its settling timer has updated the draft.
  useImperativeHandle(ref, () => ({
    getValue: () => options[Math.max(0, Math.min(options.length - 1, Math.round((viewport.current?.scrollTop ?? 0) / ROW_HEIGHT)))] ?? value,
  }), [options, value]);

  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = Math.max(0, index) * ROW_HEIGHT;
  }, [index]);
  useEffect(() => () => clearTimeout(timer.current), [options]);

  const selectIndex = (next: number) => {
    const option = options[Math.max(0, Math.min(options.length - 1, next))];
    if (option !== undefined) change.current(option);
  };

  return <div className="min-w-0 flex-1 space-y-2">
    <div className="text-center text-sm font-medium">{label}</div>
    <div className="relative overflow-hidden rounded-lg border bg-background">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-y border-primary/30 bg-primary/10" style={{ top: ROW_HEIGHT * 2, height: ROW_HEIGHT }} />
      <div
        ref={viewport}
        role="listbox"
        aria-label={label}
        className="relative touch-pan-y snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: ROW_HEIGHT * 5, paddingBlock: ROW_HEIGHT * 2 }}
        onScroll={(event) => {
          clearTimeout(timer.current);
          const scrollTop = event.currentTarget.scrollTop;
          timer.current = setTimeout(() => selectIndex(Math.round(scrollTop / ROW_HEIGHT)), 120);
        }}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1
            : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          selectIndex(next);
          viewport.current?.querySelector<HTMLButtonElement>(`[data-value="${options[Math.max(0, Math.min(options.length - 1, next))]}"]`)?.focus({ preventScroll: true });
        }}
      >
        {options.map(option => <button
          key={option}
          type="button"
          role="option"
          aria-selected={value === option}
          tabIndex={value === option ? 0 : -1}
          data-value={option}
          className={cn('flex w-full shrink-0 snap-center items-center justify-center text-xl tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', value === option ? 'font-semibold text-primary' : 'text-muted-foreground')}
          style={{ height: ROW_HEIGHT }}
          onClick={() => change.current(option)}
        >{String(option).padStart(2, '0')}</button>)}
      </div>
    </div>
  </div>;
});
