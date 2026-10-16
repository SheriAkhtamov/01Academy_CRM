import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

interface AppShellFrameProps {
  navigation: ReactNode;
  header: ReactNode;
  children: ReactNode;
  overlays?: ReactNode;
  mainRef?: Ref<HTMLElement>;
  contentRef?: Ref<HTMLDivElement>;
  className?: string;
  mainClassName?: string;
  scrollMode?: 'contained' | 'document';
}

/** The platform viewport and document scroller, independent of account type. */
export function AppShellFrame({
  navigation,
  header,
  children,
  overlays,
  mainRef,
  contentRef,
  className,
  mainClassName,
  scrollMode = 'document',
}: AppShellFrameProps) {
  return (
    <div className={cn('flex h-dvh overflow-hidden', className)} data-platform-shell>
      {navigation}
      <div ref={contentRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header gestures and ordinary module content share this document
            scroller. Boards can keep their own bounded scroll areas inside it. */}
        <main
          ref={mainRef}
          tabIndex={-1}
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-clip overscroll-y-contain outline-none [scrollbar-gutter:stable]',
            mainClassName,
          )}
          data-app-scroll={scrollMode}
        >
          {header}
          {children}
        </main>
      </div>
      {overlays}
    </div>
  );
}
