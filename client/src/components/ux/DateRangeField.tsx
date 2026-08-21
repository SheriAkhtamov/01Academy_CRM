import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';
import { academyToday } from '@/lib/localeFormat';
import { cn } from '@/lib/utils';

export type DateRangeValue = { from: string; to: string };
export type DateRangeBoundary = 'from' | 'to';

/**
 * Moves one boundary of a period and keeps the pair ordered.
 *
 * The two inputs used to constrain each other through `min`/`max`. That greys
 * today out of the native calendar whenever the opposite boundary sits in the
 * past — the picker then opens on that boundary's month instead of on today —
 * and it makes a period impossible to move forward unless the boundaries are
 * edited in one specific order. Nothing is disabled now; the opposite boundary
 * follows along instead.
 */
export const withRangeBoundary = (
  range: DateRangeValue,
  boundary: DateRangeBoundary,
  value: string,
): DateRangeValue => {
  const next: DateRangeValue = { ...range, [boundary]: value };
  if (!value || !next.from || !next.to || next.from <= next.to) return next;
  return boundary === 'from' ? { ...next, to: value } : { ...next, from: value };
};

export function DateRangeField({
  value,
  onChange,
  idPrefix,
  fromLabel,
  toLabel,
  variant = 'stacked',
  showToday = true,
  disabled = false,
  className,
  inputClassName,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Prefix for the two input ids, so several ranges can share one screen. */
  idPrefix: string;
  fromLabel?: string;
  toLabel?: string;
  /** `floating` overlays the caption on the control for tight filter bars. */
  variant?: 'stacked' | 'floating';
  showToday?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const { t } = useTranslation();
  const captions = { from: fromLabel ?? t('dateFrom'), to: toLabel ?? t('dateTo') };

  const setBoundary = (boundary: DateRangeBoundary, next: string) => {
    onChange(withRangeBoundary(value, boundary, next));
  };

  const boundaryField = (boundary: DateRangeBoundary) => {
    const id = `${idPrefix}-${boundary}`;
    const input = (
      <Input
        id={id}
        type="date"
        value={value[boundary]}
        disabled={disabled}
        onChange={(event) => setBoundary(boundary, event.target.value)}
        className={cn(variant === 'floating' && 'h-12 pt-5', 'min-w-0', inputClassName)}
      />
    );

    if (variant === 'floating') {
      return (
        <div key={boundary} className="relative min-w-0">
          <Label
            htmlFor={id}
            className="pointer-events-none absolute left-3 top-1 text-xs font-medium text-muted-foreground"
          >
            {captions[boundary]}
          </Label>
          {input}
        </div>
      );
    }

    return (
      <div key={boundary} className="min-w-0 space-y-1.5">
        <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {captions[boundary]}
        </Label>
        {input}
      </div>
    );
  };

  return (
    <div className={cn('flex min-w-0 items-end gap-2', className)}>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
        {boundaryField('from')}
        {boundaryField('to')}
      </div>
      {showToday ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn('shrink-0', variant === 'floating' ? 'h-12' : 'h-10')}
          onClick={() => {
            const today = academyToday();
            onChange({ from: today, to: today });
          }}
        >
          {t('today')}
        </Button>
      ) : null}
    </div>
  );
}
