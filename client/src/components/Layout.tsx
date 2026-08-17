import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useLocation } from 'wouter';
import Sidebar from './Sidebar';
import Header from './Header';
import { RealtimeStatusBanner } from '@/components/ux/RealtimeStatusBanner';
import { PageTransition } from '@/components/ux/motion';
import { SPRING, TRANSITION } from '@/lib/motion';
import { isContainedModuleRoute } from '@/lib/containedModuleRoutes';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const containsOwnScrollArea = isContainedModuleRoute(location);
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
        framer would win over that class and strand it off-screen.
      */}
      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] md:relative md:translate-x-0 md:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuToggle={() => setSidebarOpen(true)} />
        <RealtimeStatusBanner status={realtime.status} onReconnect={realtime.reconnect} />
        {/*
          <main> scrolls on every route, including the module pages that build
          their own scroll area. On those the page fills the element exactly, so
          `auto` shows nothing and there is still only one visible scrollbar —
          but the moment a nested height chain collapses, the rows land in a
          scroller instead of behind a clipped edge. Only the reserved gutter is
          conditional: contained pages already reserve one further in.
        */}
        <main
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-y-contain ${
            containsOwnScrollArea ? '' : '[scrollbar-gutter:stable]'
          }`}
          data-app-scroll={containsOwnScrollArea ? 'contained' : 'document'}
        >
          <PageTransition
            routeKey={location}
            className={`min-w-0 max-w-full ${containsOwnScrollArea ? 'h-full' : ''}`}
          >
            {children}
          </PageTransition>
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
    <div className="flex min-h-screen items-center justify-center">
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
