import { lazy, Suspense, useEffect, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { isLearningModulePath, isLegacyLearningPath, isPlatformAccountPath } from '@shared/platform-routes';
import { AppProviders } from './AppProviders';
import { AppRouter } from './AppRouter';
import { fetchAuthSession } from '@/lib/session';
import { setActivePlatformRealm, useActivePlatformRealm } from '@/lib/platformSession';
import { PortalApiError, portalIdentityApi } from '@/features/portal-app/api';
import { useTranslation } from '@/hooks/useTranslation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { endAuthenticatedSession, queryClient } from '@/lib/queryClient';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

const LearningModules = lazy(() => import('@/features/portal-app/PortalApp').then((module) => ({ default: module.PortalApp })));
const PublicPortfolio = lazy(() => import('@/features/portal-app/PortalApp').then((module) => ({ default: module.PublicPortfolioApp })));
type Entry = 'pending' | 'staff' | 'error';

function EntryLoading() {
  const { t } = useTranslation();
  return <div role="status" className="p-8"><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></div>;
}

/** Authentication domains stay isolated while sharing the platform's entry and UI. */
export function PlatformRouter() {
  const [path] = useLocation();
  const realm = useActivePlatformRealm();
  const { t } = useTranslation();
  const [entry, setEntry] = useState<Entry>('pending');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (realm === 'portal' || realm === 'signed-out') endAuthenticatedSession(queryClient);
  }, [realm]);
  const rootProbe = path === '/' && realm === null;
  useEffect(() => {
    if (!rootProbe) {
      setEntry('pending');
      return;
    }
    let active = true;
    setEntry('pending');
    void (async () => {
      try {
        const staff = await fetchAuthSession();
        if (!active) return;
        if (staff.kind === 'user') {
          setActivePlatformRealm('staff');
          return;
        }
        try {
          const learning = await portalIdentityApi.session();
          if (active) {
            if (learning.account) setActivePlatformRealm('portal');
            else setEntry('staff');
          }
        } catch (error) {
          if (!(error instanceof PortalApiError) || error.status !== 404) throw error;
          if (active) setEntry('staff');
        }
      } catch {
        if (active) setEntry('error');
      }
    })();
    return () => { active = false; };
  }, [rootProbe, attempt]);

  const publicPortfolio = path.match(/^\/portfolio\/p\/([^/]+)\/?$/);
  if (publicPortfolio) return <Suspense fallback={<EntryLoading />}><PublicPortfolio token={publicPortfolio[1]} /></Suspense>;
  const accountPath = isPlatformAccountPath(path) || ['/learn/activate', '/learn/invite', '/learn/recover', '/learn/reset'].includes(path.replace(/\/+$/, ''));
  if (realm === 'signed-out' && path !== '/login' && !accountPath) {
    const next = `${path}${window.location.search}${window.location.hash}`;
    return <Redirect to={`/login${path === '/' ? '' : `?next=${encodeURIComponent(next)}`}`} />;
  }
  if (realm === 'portal' && path !== '/' && path !== '/login' && !accountPath && !isLearningModulePath(path) && !isLegacyLearningPath(path)) {
    return <Redirect to="/" />;
  }
  if (rootProbe && entry === 'pending') return <EntryLoading />;
  if (rootProbe && entry === 'error') return <main className="flex min-h-dvh items-center justify-center bg-background p-4">
    <Alert variant="destructive" className="max-w-lg">
      <AlertTitle>{t('sessionCheckFailedTitle')}</AlertTitle>
      <AlertDescription><Button className="mt-4" variant="outline" onClick={() => setAttempt((value) => value + 1)}>{t('retry')}</Button></AlertDescription>
    </Alert>
  </main>;
  const learning = isLearningModulePath(path) || isLegacyLearningPath(path) || accountPath ||
    (path === '/' && realm === 'portal');
  if (learning) return <Suspense fallback={<EntryLoading />}><LearningModules /></Suspense>;
  return <AppProviders telephony={path !== '/login'}><AppRouter /></AppProviders>;
}
