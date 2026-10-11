import { initializeNavigationGuard } from '@/lib/navigationGuard';
import { AppProviders } from '@/app/AppProviders';
import { AppRouter } from '@/app/AppRouter';
import { useLocation } from 'wouter';
import { PublicAttendanceApp } from '@/app/PublicAttendanceApp';
import { lazy, Suspense } from 'react';
import { PortalProviders } from '@/app/PortalProviders';
import { useTranslation } from '@/hooks/useTranslation';

const PortalApp = lazy(() => import('@/features/portal-app/PortalApp').then((module) => ({ default: module.PortalApp })));
const PublicPortfolioApp = lazy(() => import('@/features/portal-app/PortalApp').then((module) => ({ default: module.PublicPortfolioApp })));

initializeNavigationGuard();

export default function App() {
  const [location] = useLocation();
  const { t } = useTranslation();
  if (location === '/b2b-attendance' || location === '/b2b-attendance/') return <PublicAttendanceApp />;
  const publicPortfolio = location.match(/^\/portfolio\/p\/([^/]+)\/?$/);
  if (location === '/learn' || location.startsWith('/learn/') || publicPortfolio) {
    return <PortalProviders><Suspense fallback={<div role="status" className="p-8">{t('loading')}</div>}>
      {publicPortfolio ? <PublicPortfolioApp token={publicPortfolio[1]} /> : <PortalApp />}
    </Suspense></PortalProviders>;
  }
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
