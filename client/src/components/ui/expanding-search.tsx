import { forwardRef, useContext, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { MotionConfigContext } from 'framer-motion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import './expanding-search.css';

type ExpandingSearchProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Keep the wide-screen version of an existing responsive search field open. */
  alwaysExpanded?: boolean;
};

export const ExpandingSearch = forwardRef<HTMLInputElement, ExpandingSearchProps>(function ExpandingSearch({
  value, onValueChange, expanded, onExpandedChange, alwaysExpanded = false,
  className, style, disabled, readOnly, onFocus, onBlur, onKeyDown, tabIndex,
  ...props
}, ref) {
  const { t } = useTranslation();
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const input = useRef<HTMLInputElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [localExpanded, setLocalExpanded] = useState(false);
  const open = alwaysExpanded || Boolean(expanded ?? localExpanded) || value.length > 0;
  const label = props['aria-label'] ?? props.placeholder ?? t('search');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const motionConfig = useContext(MotionConfigContext);
  const instant = motionConfig.transition?.duration === 0;
  const reduce = reducedMotion || motionConfig.reducedMotion === 'always';

  const setExpanded = (next: boolean) => {
    setLocalExpanded(next);
    onExpandedChange?.(next);
  };
  const openSearch = () => {
    if (disabled || input.current?.matches(':disabled')) return;
    setExpanded(true);
    // Focus synchronously with the user's press so mobile keyboards open reliably.
    input.current?.focus();
  };
  const closeSearch = () => {
    if (!readOnly) onValueChange('');
    setExpanded(false);
    if (alwaysExpanded) input.current?.focus();
    else restoreFocus.current = true;
  };

  useLayoutEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    // The trigger is hidden while expanded; wait for the closed DOM before focusing it.
    trigger.current?.focus();
  }, [open]);

  return (
    <div
      className={cn('expanding-search', className)}
      style={style}
      data-expanded={open ? 'true' : 'false'}
      data-search-motion={instant ? 'off' : reduce ? 'reduced' : undefined}
      aria-disabled={disabled || undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !value) setExpanded(false);
      }}
    >
      <svg aria-hidden="true" className="expanding-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.5-4.5" />
      </svg>
      <input
        {...props}
        id={id}
        ref={(node) => {
          input.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className="expanding-search-input"
        type="search"
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={label}
        aria-hidden={!open || undefined}
        tabIndex={open ? tabIndex : -1}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={(event) => { setExpanded(true); onFocus?.(event); }}
        onBlur={onBlur}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }}
      />
      <button
        ref={trigger}
        type="button"
        className="expanding-search-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-hidden={open || undefined}
        tabIndex={open ? -1 : 0}
        disabled={disabled}
        onClick={openSearch}
      />
      <button
        type="button"
        className="expanding-search-clear"
        aria-label={value ? t('clearSearch') : t('close')}
        aria-hidden={!open || undefined}
        tabIndex={open ? 0 : -1}
        disabled={disabled || readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (value) {
            onValueChange('');
            setExpanded(true);
            input.current?.focus();
          } else closeSearch();
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
});
