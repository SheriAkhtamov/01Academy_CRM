import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useLocation } from 'wouter';
import Sidebar from './Sidebar';
import Header from './Header';
import { RealtimeStatusBanner } from '@/components/ux/RealtimeStatusBanner';
import { AppErrorBoundary } from '@/components/ux/AppErrorBoundary';
import { PageTransition } from '@/components/ux/motion';
import { SPRING, TRANSITION } from '@/lib/motion';
import { isContainedModuleRoute } from '@/lib/containedModuleRoutes';

interface LayoutProps {
  children: React.ReactNode;
}

const scrollPositionKey = (path: string) => `app-scroll:${path}`;

export default function Layout({ children }: LayoutProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { t } = useTranslation();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Scroll restoration: push navigations start at the top, Back/Forward
  // restores where the user was. `<main>` is the permanent document scroller.
  const mainRef = useRef<HTMLElement | null>(null);
  const lastLocation = useRef(location);
  const popNavigation = useRef(false);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const markPop = () => {
      popNavigation.current = true;
    };
    window.addEventListener('popstate', markPop);
    return () => window.removeEventListener('popstate', markPop);
  }, []);

  useEffect(() => {
    if (lastLocation.current === location) return undefined;
    const isPop = popNavigation.current;
    popNavigation.current = false;
    lastLocation.current = location;
    const el = mainRef.current;
    if (!el) return undefined;
    el.focus({ preventScroll: true });
    if (!isPop) {
      el.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
      return undefined;
    }
    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem(scrollPositionKey(location)) ?? '0');
    } catch {
      saved = 0;
    }
    const frame = requestAnimationFrame(() => {
      el.scrollTo({ top: saved, behavior: 'instant' as ScrollBehavior });
    });
    return () => cancelAnimationFrame(frame);
  }, [location]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return undefined;
    let scheduled = false;
    const saveScroll = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        try {
          sessionStorage.setItem(scrollPositionKey(location), String(Math.round(el.scrollTop)));
        } catch {
          // Storage full/unavailable — losing scroll restore is acceptable.
        }
      });
    };
    el.addEventListener('scroll', saveScroll, { passive: true });
    return () => el.removeEventListener('scroll', saveScroll);
  }, [location]);

  // The drawer dims the page and traps the eye like a dialog, so it answers to
  // Escape like one. Bound only while it is open, so it can never swallow an
  // Escape meant for a dialog above it.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  // While the mobile drawer is open the page behind it becomes inert, focus
  // starts on the drawer's first link, closing hands focus back to the burger,
  // and Tab cycles inside the drawer. Docked desktop navigation never opens
  // through this path, so a resize race leaves the page untouched.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      return undefined;
    }
    const page = pageContentRef.current;
    const toggle = menuToggleRef.current;
    const frame = requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      drawer?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    });
    if (page) page.inert = true;
    return () => {
      cancelAnimationFrame(frame);
      if (page) page.inert = false;
      toggle?.focus({ preventScroll: true });
    };
  }, [sidebarOpen]);

  const handleDrawerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !sidebarOpen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && drawer.contains(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const containsOwnScrollArea = isContainedModuleRoute(location, user?.module);
  const realtime = useWebSocket();

  if (isLoading) {
    return <AppSpinner label={t('loading')} />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION.fast}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/*
        The drawer transform stays on Tailwind rather than framer: `md:translate-x-0`
        is what keeps the sidebar docked on desktop, and an inline transform from
        framer would win over that class and strand it off-screen. While closed
        the drawer is `invisible`, so its off-screen links leave the tab order
        and screen-reader tree; the visibility switch is delayed on close until
        the slide-out finishes.
      */}
      <div
        ref={drawerRef}
        onKeyDown={handleDrawerKeyDown}
        className={`
          fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] md:relative md:translate-x-0 md:visible md:z-auto
          ${sidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}
        `}
        style={{
          transitionProperty: 'transform, visibility',
          transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1), linear',
          transitionDelay: sidebarOpen ? '0ms, 0ms' : '0ms, 300ms',
        }}
      >
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      <div ref={pageContentRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuToggle={() => setSidebarOpen(true)} menuButtonRef={menuToggleRef} />
        <RealtimeStatusBanner status={realtime.status} onReconnect={realtime.reconnect} />
        {/*
          <main> scrolls on every route, including the module pages that build
          their own scroll area. On those the page fills the element exactly, so
          `auto` shows nothing and there is still only one visible scrollbar —
          but the moment a nested height chain collapses, the rows land in a
          scroller instead of behind a clipped edge. Only the reserved gutter is
          conditional: contained pages already reserve one further in.

          The page boundary sits inside the layout so a crash in one page no
          longer wipes the header, sidebar and telephony widget with it.
        */}
        <main
          ref={mainRef}
          tabIndex={-1}
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-y-contain outline-none ${
            containsOwnScrollArea ? '' : '[scrollbar-gutter:stable]'
          }`}
          data-app-scroll={containsOwnScrollArea ? 'contained' : 'document'}
        >
          <AppErrorBoundary variant="page">
            <PageTransition
              routeKey={location}
              className={`min-w-0 max-w-full ${containsOwnScrollArea ? 'h-full' : ''}`}
            >
              {children}
            </PageTransition>
          </AppErrorBoundary>
        </main>
      </div>
    </div>
  );
}

/**
 * Two counter-rotating arcs instead of one spinner ring — it reads as an
 * intentional loading state rather than a stalled browser throbber, and the
 * label fades up underneath so the pair lands together.
 */
export function AppSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="text-center">
        <div className="relative mx-auto mb-4 h-11 w-11">
          <motion.span
            className="absolute inset-0 rounded-full border-[3px] border-muted border-t-primary-600"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}
          />
          <motion.span
            className="absolute inset-[6px] rounded-full border-2 border-transparent border-b-primary-500/70"
            animate={{ rotate: -360 }}
            transition={{ duration: 1.4, ease: 'linear', repeat: Infinity }}
          />
        </div>
        <motion.p
          className="text-sm text-muted-foreground"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING.gentle, delay: 0.1 }}
        >
          {label}
        </motion.p>
      </div>
    </div>
  );
}
