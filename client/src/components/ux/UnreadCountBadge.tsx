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

export function UnreadCountBadge({
  count,
  label,
  announce = false,
  className,
}: UnreadCountBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      role={announce ? 'status' : undefined}
      aria-label={label}
      aria-live={announce ? 'polite' : undefined}
      aria-atomic={announce ? 'true' : undefined}
      className={cn(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold leading-none tabular-nums text-destructive-foreground shadow-sm ring-2 ring-background',
        className,
      )}
    >
      {formatUnreadCount(count)}
    </span>
  );
}
