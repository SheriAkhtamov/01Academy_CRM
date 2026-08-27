import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CurrencyInput } from '@/components/ux/FormattedInputs';
import { SegmentedControl } from '@/components/ux/lead/LeadSheetControls';
import { cn } from '@/lib/utils';

/**
 * The controls a filter panel is built from.
 *
 * They exist as their own file because the shape of a filter row is a layout
 * decision repeated a dozen times: a bordered card per condition reads as
 * twelve competing boxes, so everything here is deliberately flat — one label,
 * one control, one hairline between groups.
 */

type IconComponent = typeof Check;

/** Roughly what an open option panel needs: its list cap plus its own padding. */
const PANEL_HEIGHT_ALLOWANCE = 260;

/** A titled run of filters, separated by a rule rather than a box. */
export function FilterSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2.5', className)} aria-label={title}>
      <div className="flex items-center gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
      </div>
      {children}
    </section>
  );
}

/**
 * `id` names the control this label belongs to. The label element itself is
 * given `${id}-label`, which is what lets a combobox point at both its caption
 * and its own summary and be read out as "Source: Instagram +1".
 */
export function FilterField({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label id={`${id}-label`} htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export interface FilterOption<T extends string | number> {
  id: T;
  label: string;
  /** How many records carry this value, shown as a quiet hint in the list. */
  count?: number;
}

/**
 * A multi-select that stays one control tall no matter how many options it
 * holds. The chip cloud it replaces grew with the team; this does not, and the
 * chosen values stay readable on the closed trigger.
 */
export function FilterMultiSelect<T extends string | number>({
  id,
  placeholder,
  options,
  selected,
  onChange,
  searchPlaceholder,
  emptyText,
}: {
  id: string;
  placeholder: string;
  options: Array<FilterOption<T>>;
  selected: readonly T[];
  onChange: (next: T[]) => void;
  searchPlaceholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  // A panel left open under the pointer covers the filters below it. The
  // dialog around this already traps focus, so only the outside press matters.
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // A search box over five options is furniture; over a whole sales team it is
  // the only way in.
  const searchable = options.length > 6;

  /*
    The panel lives inside the dialog's own scroll box, which clips it: opened
    from the lower half it would hang below the fold and have to be scrolled
    to. Measuring once on open and flipping it above the trigger keeps the
    options where the press happened.
  */
  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    setDropUp(spaceBelow < PANEL_HEIGHT_ALLOWANCE && rect.top > spaceBelow);
    if (searchable) searchRef.current?.focus();
  }, [open, searchable]);
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!searchable || needle === '') return options;
    return options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
  }, [options, query, searchable]);

  const selectedLabels = options
    .filter((option) => selected.includes(option.id))
    .map((option) => option.label);
  const summary = selectedLabels.length === 0
    ? placeholder
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `${selectedLabels[0]} +${selectedLabels.length - 1}`;

  const closePanel = () => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const moveFocus = (delta: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = current === -1
      ? (delta > 0 ? 0 : items.length - 1)
      : (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  const toggle = (value: T) => {
    onChange(selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${id}-label ${id}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-input-background px-3 text-sm shadow-2xs transition-[border-color,box-shadow] hover:border-primary/50 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary/15',
          open && 'border-primary-500 ring-4 ring-primary/15',
        )}
      >
        <span className={cn('truncate', selectedLabels.length === 0 && 'text-muted-foreground')}>
          {summary}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          className={cn(
            'absolute left-0 z-50 w-full min-w-[12rem] max-w-full rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            dropUp ? 'bottom-[calc(100%+0.25rem)]' : 'top-[calc(100%+0.25rem)]',
          )}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // Without this the dialog itself would close on the same press.
              event.preventDefault();
              event.stopPropagation();
              closePanel();
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveFocus(1);
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {searchable ? (
            <div className="p-1 pb-1.5">
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8"
                onKeyDown={(event) => {
                  // Enter here would submit the surrounding form and apply a
                  // draft the user is still assembling.
                  if (event.key === 'Enter') event.preventDefault();
                }}
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-labelledby={`${id}-label`}
            className="max-h-56 overflow-y-auto overscroll-contain"
          >
            {visibleOptions.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggle(option.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input',
                    )}
                  >
                    {isSelected ? <Check className="size-3" /> : null}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate', isSelected && 'font-medium')}>
                    {option.label}
                  </span>
                  {typeof option.count === 'number' ? (
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                    >
                      {option.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {visibleOptions.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One presence condition per line: what is being asked on the left, the answer
 * on the right. Stacking the caption above a full-width segmented control
 * turned four of these into eight rows of near-identical shapes.
 */
export function FilterTriStateRow({
  icon: Icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 py-1.5 pl-2.5 pr-1.5">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </span>
      <SegmentedControl
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={options}
        className="w-[9.5rem] shrink-0 border-transparent bg-background/80 p-0.5 [&>button]:px-1 [&>button]:py-1 [&>button]:text-xs"
      />
    </div>
  );
}

/** A plain on/off condition, in the same row rhythm as the tri-states. */
export function FilterSwitchRow({
  icon: Icon,
  label,
  checked,
  onCheckedChange,
}: {
  icon: IconComponent;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 rounded-lg border py-1.5 pl-2.5 pr-2.5 transition-colors',
        checked ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-muted/30',
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Icon
          aria-hidden="true"
          className={cn('size-3.5 shrink-0', checked ? 'text-primary' : 'text-muted-foreground')}
        />
        <span className="truncate">{label}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

/**
 * A pair of bounds under one caption.
 *
 * An `<input>` carries an intrinsic min-content width of roughly 170px, and
 * `min-width: auto` on a flex item means it is never asked to go below it. Two
 * side by side therefore demanded ~350px whatever the box around them was,
 * which pushed the field past the edge of the dialog on a phone. `min-w-0` is
 * what lets them share what there is.
 */
export function FilterRangeField({
  id,
  label,
  fromValue,
  toValue,
  onFromChange,
  onToChange,
  fromLabel,
  toLabel,
  variant = 'number',
  footer,
}: {
  id: string;
  label: string;
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  fromLabel: string;
  toLabel: string;
  variant?: 'number' | 'date' | 'currency';
  footer?: React.ReactNode;
}) {
  const renderInput = (
    boundary: 'from' | 'to',
    value: string,
    onChange: (next: string) => void,
    boundLabel: string,
  ) => {
    const shared = {
      id: `${id}-${boundary}`,
      className: 'h-9 min-w-0',
      'aria-label': `${label}: ${boundLabel}`,
      placeholder: boundLabel,
    };
    if (variant === 'currency') {
      return <CurrencyInput {...shared} value={value} onValueChange={onChange} />;
    }
    return (
      <Input
        {...shared}
        type={variant}
        min={variant === 'number' ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <Label id={`${id}-label`} htmlFor={`${id}-from`} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        {renderInput('from', fromValue, onFromChange, fromLabel)}
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">—</span>
        {renderInput('to', toValue, onToChange, toLabel)}
      </div>
      {footer}
    </div>
  );
}

/** A one-press shortcut that fills a range, rendered under the inputs. */
export function FilterPresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active
          ? 'border-primary bg-primary/10 font-medium text-primary'
          : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
