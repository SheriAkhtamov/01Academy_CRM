import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

const TREND_ICONS = {
  up: ArrowUp,
  down: ArrowDown,
} as const;

/**
 * The signed change against the previous window.
 *
 * `invert` flips which direction is good — refusals going up is not a win. The
 * arrow always follows the arithmetic sign; only the colour follows `invert`,
 * so a reader who ignores colour still gets the direction right.
 */
export function TrendBadge({
  delta,
  invert = false,
  suffix,
  className,
}: {
  delta: number | null;
  invert?: boolean;
  suffix?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (delta === null) return null;
  if (delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground',
          className,
        )}
        title={t('previousPeriodLabel')}
      >
        <Minus className="size-3" aria-hidden="true" />0{suffix}
      </span>
    );
  }
  const positive = invert ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TREND_ICONS.up : TREND_ICONS.down;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        positive
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400',
        className,
      )}
      title={t('previousPeriodLabel')}
    >
      <Icon className="size-3" aria-hidden="true" />
      {delta > 0 ? '+' : ''}{delta}{suffix}
    </span>
  );
}

/**
 * The previous-period figure, spelled out.
 *
 * A delta pill alone answers "by how much" but never "from what", and the
 * screen used to hide the answer in a `title` attribute — invisible on a touch
 * device and to anyone reading with the keyboard.
 */
export function PreviousValue({ value, className }: { value: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn('text-[11px] leading-4 tabular-nums text-muted-foreground', className)}>
      {t('before')} {value}
    </span>
  );
}
