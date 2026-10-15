import { forwardRef, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { timezoneOptions, timezoneSearchText } from './timezones';

type TimezoneSelectProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  onPopupOpenChange?: (open: boolean) => void;
};

export const TimezoneSelect = forwardRef<HTMLInputElement, TimezoneSelectProps>(function TimezoneSelect({
  value, onChange, onBlur, onPopupOpenChange, className, disabled, ...props
}, forwardedRef) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const notifyRef = useRef(onPopupOpenChange);
  notifyRef.current = onPopupOpenChange;
  const listId = useId();
  const catalog = useMemo(() => timezoneOptions(value, t), [t, value]);
  const options = useMemo(() => catalog.filter(option => timezoneSearchText(option.label).includes(timezoneSearchText(query))), [catalog, query]);
  const selected = catalog.find(option => option.value === value)?.label ?? value;
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const popup = (next: boolean) => {
    setOpen(next);
    notifyRef.current?.(next);
    if (!next) setQuery('');
  };
  const show = () => {
    if (disabled || open) return;
    setQuery('');
    setActive(Math.max(0, catalog.findIndex(option => option.value === value)));
    popup(true);
  };
  const select = (next: string) => {
    onChange(next);
    popup(false);
    inputRef.current?.focus();
  };
  useEffect(() => () => notifyRef.current?.(false), []);
  useEffect(() => {
    if (!open && document.activeElement === inputRef.current) inputRef.current?.select();
  }, [open, selected]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false); setQuery(''); notifyRef.current?.(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listId, open]);

  return <div ref={rootRef} className="min-w-0">
    <div className="relative">
      <Input {...props} ref={node => {
        inputRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }} type="text" role="combobox" autoComplete="off" disabled={disabled}
        aria-expanded={open} aria-autocomplete="list" aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options.length ? `${listId}-${activeIndex}` : undefined}
        className={cn('pr-9', className)} value={open ? query : selected}
        onClick={show} onFocus={show}
        onChange={event => { if (!open) popup(true); setQuery(event.target.value); setActive(0); }}
        onBlur={event => {
          if (!rootRef.current?.contains(event.relatedTarget as Node)) popup(false);
          onBlur?.(event);
        }}
        onKeyDown={event => {
          if (event.key === 'Tab') { popup(false); return; }
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); popup(false); return; }
          if (event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation();
            if (!open) show(); else if (options[activeIndex]) select(options[activeIndex].value);
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          if (!open) { if (event.key.startsWith('Arrow')) { event.preventDefault(); show(); } return; }
          event.preventDefault();
          setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, options.length - 1)
            : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
        }} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={t('selectTimezone')}
        className="absolute right-1 top-1 flex size-7 items-center justify-center rounded text-muted-foreground"
        onMouseDown={event => event.preventDefault()} onClick={() => { if (open) popup(false); else show(); inputRef.current?.focus(); }}>
        <ChevronDown className="size-4" />
      </button>
    </div>
    {open ? <div className="mt-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <div id={listId} role="listbox" aria-label={t('timezone')} className="max-h-56 overflow-y-auto overscroll-contain">
        {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
          aria-selected={option.value === value} onPointerDown={event => event.preventDefault()}
          onClick={() => select(option.value)}
          className={cn('flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-sm', index === activeIndex && 'bg-accent text-accent-foreground')}>
          <span className="min-w-0 break-words">{option.label}</span>
          {option.value === value ? <Check className="size-4 shrink-0" /> : null}
        </div>)}
        {!options.length ? <p role="status" className="px-2 py-2 text-sm">{t('noTimezonesFound')}</p> : null}
      </div>
    </div> : null}
  </div>;
});
