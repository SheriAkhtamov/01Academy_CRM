import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ModulePageProps {
  children: ReactNode;
  contained?: boolean;
  className?: string;
}

interface ModulePageBodyProps {
  children: ReactNode;
  contained?: boolean;
  scroll?: 'auto' | 'hidden';
  ariaLabel?: string;
  className?: string;
}

/**
 * Keeps operational modules inside the available app viewport while
 * letting ordinary content use the shell's page scroller.
 *
 * `h-full` lets boards and calendars resolve their percentage heights. The
 * box does not clip, so long content reaches the shell scroller.
 */
export function ModulePage({ children, contained = false, className }: ModulePageProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full min-w-0 max-w-[1600px]',
        contained
          ? 'flex h-full min-h-0 flex-col p-4 sm:p-5 lg:p-6 [&>[data-page-header]]:mb-4'
          : 'p-4 sm:p-6 lg:p-8',
        className,
      )}
      data-module-page={contained ? 'contained' : 'document'}
    >
      {children}
    </div>
  );
}

/**
 * Ordinary operational content flows into the shell's page scroller. Boards,
 * calendars and fixed tables still provide bounded scroll areas where needed.
 */
export function ModulePageBody({
  children,
  contained = false,
  scroll = 'auto',
  ariaLabel,
  className,
}: ModulePageBodyProps) {
  if (!contained) return <>{children}</>;

  return (
    <div
      className={cn('min-h-0 min-w-0 flex-1', className)}
      data-module-scroll={scroll}
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
