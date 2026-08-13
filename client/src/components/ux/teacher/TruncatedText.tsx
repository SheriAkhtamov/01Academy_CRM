import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface TruncatedTextProps {
  text: string;
  lines?: 1 | 2;
  className?: string;
}

const CLAMP_CLASS = {
  1: 'truncate',
  2: 'line-clamp-2',
} as const;

/**
 * A native `title` is the one affordance a touch device cannot use at all, and
 * a Radix tooltip is barely better — by the ARIA pattern it opens on hover and
 * focus, never on tap. So truncated text reveals itself in place: the element
 * measures whether it actually overflows and only then becomes a button that
 * toggles the clamp. Text that fits stays a plain span and never appears in the
 * tab order, which keeps a seven-day schedule from growing dozens of stops.
 */
export function TruncatedText({ text, lines = 1, className }: TruncatedTextProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const elementRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    setOverflows(
      element.scrollWidth > element.clientWidth + 1
      || element.scrollHeight > element.clientHeight + 1,
    );
  }, []);

  useEffect(() => {
    if (expanded) return undefined;
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    if (elementRef.current) observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, [expanded, measure, text]);

  const content = (
    <span
      ref={elementRef}
      className={cn(expanded ? 'break-words' : CLAMP_CLASS[lines], className)}
    >
      {text}
    </span>
  );

  if (!overflows && !expanded) return content;

  return (
    // The action goes in a description, never in `aria-label`: a label would
    // override the accessible name, and the screen reader would announce "show
    // the full text" in place of the group name or lesson topic the button
    // actually contains — worse than the native `title` this replaced. The
    // clamped text stays the name, `aria-expanded` carries the state.
    <button
      type="button"
      aria-expanded={expanded}
      aria-describedby={hintId}
      onClick={() => setExpanded((current) => !current)}
      className="block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
      <span id={hintId} className="sr-only">
        {expanded ? t('collapseText') : t('expandText')}
      </span>
    </button>
  );
}
