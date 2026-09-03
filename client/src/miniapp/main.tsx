import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import { clearMiniSession, launchMiniApp, miniAuthApi, telegramApp } from '@/features/board/telegram';
import { TasksApp } from './TasksApp';
import '@/index.css';
import './miniapp.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: true }, mutations: { retry: false } } });
function MiniApp() {
  const { t } = useTranslation();
  const [expired, setExpired] = useState(false);
  const launch = useQuery({ queryKey: ['mini-launch'], queryFn: launchMiniApp, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  useEffect(() => {
    document.title = t('miniTasksTitle');
    document.body.classList.add('telegram-tasks');
    const app = telegramApp();
    const theme = () => document.documentElement.classList.toggle('dark', app?.colorScheme === 'dark');
    theme();
    app?.ready();
    app?.expand();
    app?.onEvent('themeChanged', theme);
    const expire = () => { clearMiniSession(); setExpired(true); };
    window.addEventListener('miniapp-auth-expired', expire);
    return () => { app?.offEvent('themeChanged', theme); window.removeEventListener('miniapp-auth-expired', expire); };
  }, [t]);
  useEffect(() => { if (launch.data) client.setQueryData(AUTH_SESSION_QUERY_KEY, launch.data); }, [launch.data]);
  if (expired) return <div className="mini-center"><p>{t('miniTasksSessionExpired')}</p></div>;
  if (launch.isError) return <div className="mini-center" role="alert"><p>{!telegramApp()?.initData ? t('miniTasksOpenTelegram') : (launch.error as { status?: number }).status === 401 ? t('miniTasksSessionExpired') : t('miniTasksUnavailable')}</p><Button variant="outline" onClick={() => void launch.refetch()}>{t('retry')}</Button></div>;
  if (!launch.data) return <div className="mini-center"><Loader2 className="size-7 animate-spin" aria-label={t('loading')} /></div>;
  return <AuthProvider api={miniAuthApi}><TasksApp /></AuthProvider>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><TooltipProvider><MiniApp /><Toaster /></TooltipProvider></QueryClientProvider>);
