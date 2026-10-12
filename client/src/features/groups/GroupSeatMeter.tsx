import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { GroupSeats } from './presentation';

/** Past this many seats single cells get too thin to count, so the meter becomes a bar. */
const MAX_CELLS = 24;

const FILLED_CLASS = {
  available: 'bg-emerald-500 dark:bg-emerald-400',
  few: 'bg-amber-500 dark:bg-amber-400',
  full: 'bg-rose-500 dark:bg-rose-400',
  closed: 'bg-muted-foreground/50',
} as const;

const RESERVED_CLASS = {
  available: 'bg-emerald-500/40 dark:bg-emerald-400/40',
  few: 'bg-amber-500/40 dark:bg-amber-400/40',
  full: 'bg-rose-500/40 dark:bg-rose-400/40',
  closed: 'bg-muted-foreground/25',
} as const;

export function useSeatMeterLabel() {
  const { t } = useTranslation();
  return (seats: GroupSeats) => t('groupSeatsMeterLabel')
    .replace('{current}', String(seats.current))
    .replace('{reserved}', String(seats.reserved))
    .replace('{free}', String(seats.free))
    .replace('{max}', String(seats.max));
}

/**
 * One cell per seat: studying, reserved, free. Seeing "three empty chairs" is
 * faster than reading "Free seats: 3", and the reserved ones stop hiding inside
 * the occupied number.
 */
export function GroupSeatMeter({ seats, size = 'sm', className }: {
  seats: GroupSeats;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const label = useSeatMeterLabel()(seats);
  const total = Math.max(seats.max, seats.occupied);
  const cellHeight = size === 'lg' ? 'h-3' : 'h-2';

  if (total === 0) return null;

  if (total > MAX_CELLS) {
    const percent = (value: number) => `${(value / total) * 100}%`;
    return (
      <div role="img" aria-label={label} className={cn('flex w-full overflow-hidden rounded-full bg-muted', cellHeight, className)}>
        <span className={FILLED_CLASS[seats.tone]} style={{ width: percent(seats.current) }} />
        <span className={RESERVED_CLASS[seats.tone]} style={{ width: percent(seats.reserved) }} />
      </div>
    );
  }

  return (
    <div role="img" aria-label={label} className={cn('flex flex-wrap gap-0.5', className)}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'rounded-[2px]',
            size === 'lg' ? 'w-3' : 'w-1.5',
            cellHeight,
            index < seats.current
              ? FILLED_CLASS[seats.tone]
              : index < seats.occupied
                ? RESERVED_CLASS[seats.tone]
                : 'bg-muted ring-1 ring-inset ring-border',
          )}
        />
      ))}
    </div>
  );
}
