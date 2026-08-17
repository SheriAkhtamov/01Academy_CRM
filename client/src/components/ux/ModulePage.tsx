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
 * preserving natural document scrolling for dashboard/overview pages.
 *
 * `h-full` is what lets boards and calendars inside resolve their own
 * percentage heights, but the box deliberately does not clip: if a child grows
 * past it, the rows spill into the <main> scroller rather than disappearing
 * behind a hidden edge.
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
 * The single vertical scroller for ordinary operational pages. Boards,
 * calendars and fixed tables can opt out and provide their own scroll areas.
 *
 * Opting out clips the horizontal axis only. A child that owns the scroll and
 * gets its height wrong would otherwise clip its own overflow away here, one
 * level below the nearest real scroller.
 */
export function ModulePageBody({
  children,
  contained = false,
  scroll = 'auto',
  ariaLabel,
  className,
}: ModulePageBodyProps) {
  if (!contained) return <>{children}</>;

  const scrollable = scroll === 'auto';
  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex-1',
        scrollable
          ? 'overflow-y-auto overflow-x-clip overscroll-y-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
          : 'overflow-x-clip',
        className,
      )}
      data-module-scroll={scroll}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? ariaLabel : undefined}
      tabIndex={scrollable ? 0 : undefined}
    >
      {children}
    </div>
  );
}
