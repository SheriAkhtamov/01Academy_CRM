import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode, type Ref } from 'react';
import { AppShellFrame } from './AppShellFrame';

const hasOpenDialog = () => Boolean(document.querySelector(
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
));

export interface PlatformLayoutProps {
  children: ReactNode;
  mainRef: MutableRefObject<HTMLElement | null>;
  navigationKey: string;
  renderSidebar: (props: { onClose: () => void; isOpen: boolean }) => ReactNode;
  renderHeader: (props: { onMenuToggle: () => void; menuButtonRef: Ref<HTMLButtonElement> }) => ReactNode;
  scrollMode?: 'contained' | 'document';
  className?: string;
  mainClassName?: string;
  overlays?: ReactNode;
}

/** Shared viewport, desktop navigation, and mobile drawer lifecycle. */
export function PlatformLayout({
  children, mainRef, navigationKey, renderSidebar, renderHeader,
  scrollMode, className, mainClassName, overlays,
}: PlatformLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);
  const previousNavigation = useRef(navigationKey);
  const focusMainOnClose = useRef(false);

  // The permanent <main> owns document scrolling for every platform role.
  useLayoutEffect(() => {
    document.documentElement.classList.add('app-shell-active');
    return () => document.documentElement.classList.remove('app-shell-active');
  }, []);

  useEffect(() => {
    if (previousNavigation.current === navigationKey) return;
    previousNavigation.current = navigationKey;
    focusMainOnClose.current = true;
    setSidebarOpen(false);
  }, [navigationKey]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !hasOpenDialog())
        setSidebarOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) {
        focusMainOnClose.current = true;
        setSidebarOpen(false);
      }
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  // Mobile navigation makes the page inert, starts focus inside the drawer,
  // and restores focus to either the destination or the opening menu button.
  useEffect(() => {
    if (!sidebarOpen || window.matchMedia('(min-width: 1024px)').matches)
      return undefined;
    const page = pageContentRef.current;
    const toggle = menuToggleRef.current;
    const main = mainRef.current;
    const frame = requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      // A quick selection can open a dialog or restore its opener before this
      // frame runs. Preserve that focus instead of restarting drawer entry.
      if (!drawer || hasOpenDialog() || drawer.contains(document.activeElement)) return;
      drawer.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    });
    if (page) page.inert = true;
    return () => {
      cancelAnimationFrame(frame);
      if (page) page.inert = false;
      // A dialog opened from navigation owns the next focus destination.
      if (hasOpenDialog()) return;
      if (focusMainOnClose.current) main?.focus({ preventScroll: true });
      else toggle?.focus({ preventScroll: true });
    };
  }, [sidebarOpen, mainRef]);

  useEffect(() => {
    if (sidebarOpen) return undefined;
    // A closing dialog can restore its old focus after navigation effects run.
    // Never leave that focus on a link in the closed mobile drawer.
    const keepFocusOutsideDrawer = (event: FocusEvent) => {
      if (!focusMainOnClose.current || window.matchMedia('(min-width: 1024px)').matches || hasOpenDialog()) return;
      if (!(event.target instanceof Node) || !drawerRef.current?.contains(event.target)) return;
      event.stopPropagation();
      mainRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepFocusOutsideDrawer, true);
    return () => document.removeEventListener('focusin', keepFocusOutsideDrawer, true);
  }, [sidebarOpen, mainRef]);

  const handleDrawerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !sidebarOpen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusables = Array.from(drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && drawer.contains(active);
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AppShellFrame
      mainRef={mainRef}
      contentRef={pageContentRef}
      scrollMode={scrollMode}
      className={className}
      mainClassName={mainClassName}
      overlays={overlays}
      navigation={(
        <>
          {/* Remove the backdrop immediately on navigation or viewport change. */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
              onClick={closeSidebar}
              aria-hidden="true"
            />
          )}
          {/* Tailwind owns the transform so desktop docking wins over motion.
              Closed links leave both the tab order and screen-reader tree. */}
          <div
            ref={drawerRef}
            data-platform-drawer={sidebarOpen ? 'open' : 'closed'}
            onKeyDown={handleDrawerKeyDown}
            className={`
              fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] lg:relative lg:translate-x-0 lg:visible lg:z-auto
              ${sidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}
            `}
            style={{
              transitionProperty: 'transform, visibility',
              transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1), linear',
              transitionDelay: sidebarOpen ? '0ms, 0ms' : '0ms, 300ms',
            }}
          >
            {renderSidebar({ onClose: closeSidebar, isOpen: sidebarOpen })}
          </div>
        </>
      )}
      header={renderHeader({
        onMenuToggle: () => {
          focusMainOnClose.current = false;
          setSidebarOpen(true);
        },
        menuButtonRef: menuToggleRef,
      })}
    >
      {children}
    </AppShellFrame>
  );
}
