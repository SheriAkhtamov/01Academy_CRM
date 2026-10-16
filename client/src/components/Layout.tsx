import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useLocation } from 'wouter';
import Sidebar from './Sidebar';
import Header from './Header';
import { RealtimeStatusBanner } from '@/components/ux/RealtimeStatusBanner';
import { AppErrorBoundary } from '@/components/ux/AppErrorBoundary';
import { PageTransition } from '@/components/ux/motion';
import { SPRING } from '@/lib/motion';
import { isContainedModuleRoute } from '@/lib/containedModuleRoutes';
import { PlatformLayout } from '@/components/ux/PlatformLayout';

interface LayoutProps {
  children: React.ReactNode;
}

const scrollPositionKey = (path: string) => `app-scroll:${path}`;

export default function Layout({ children }: LayoutProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { t } = useTranslation();
  const [location] = useLocation();
  // Scroll restoration: push navigations start at the top, Back/Forward
  // restores where the user was. `<main>` is the permanent document scroller.
  const mainRef = useRef<HTMLElement | null>(null);
  const lastLocation = useRef(location);
  const popNavigation = useRef(false);
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

  const containsOwnScrollArea = isContainedModuleRoute(location, user?.module);
  const realtime = useWebSocket();

  if (isLoading) {
    return <AppSpinner label={t('loading')} />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <PlatformLayout
      mainRef={mainRef}
      navigationKey={location}
      scrollMode={containsOwnScrollArea ? 'contained' : 'document'}
      renderSidebar={(props) => <Sidebar {...props} />}
      renderHeader={(props) => <Header {...props} />}
    >
      <RealtimeStatusBanner status={realtime.status} onReconnect={realtime.reconnect} />
      {/* Keep page failures inside the shell so navigation remains available. */}
      <AppErrorBoundary variant="page">
        <PageTransition
          routeKey={location}
          className="min-h-0 min-w-0 max-w-full flex-1"
        >
          {children}
        </PageTransition>
      </AppErrorBoundary>
    </PlatformLayout>
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
