import { cn } from '@/lib/utils';

type UnreadCountBadgeProps = {
  count: number;
  label: string;
  announce?: boolean;
  className?: string;
};

export const formatUnreadCount = (count: number): string => {
  const normalizedCount = Number.isFinite(count)
    ? Math.max(0, Math.trunc(count))
    : 0;
  return normalizedCount > 99 ? '99+' : String(normalizedCount);
};

const badgeClassName = 'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold leading-none tabular-nums text-destructive-foreground shadow-sm ring-2 ring-background';

export function UnreadCountBadge({
  count,
  label,
  announce = false,
  className,
}: UnreadCountBadgeProps) {
  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

  if (!announce) {
    if (normalizedCount <= 0) return null;

    return (
      <span aria-label={label} className={cn(badgeClassName, className)}>
        {formatUnreadCount(normalizedCount)}
      </span>
    );
  }

  // A live region only announces updates that happen while it is already in the
  // DOM. Unmounting the badge at zero meant the region was inserted together
  // with its text and screen readers stayed silent, so keep it mounted always
  // and let the visible bubble come and go instead.
  return (
    <>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {normalizedCount > 0 ? label : ''}
      </span>
      {normalizedCount > 0 ? (
        <span aria-hidden="true" className={cn(badgeClassName, className)}>
          {formatUnreadCount(normalizedCount)}
        </span>
      ) : null}
    </>
  );
}
