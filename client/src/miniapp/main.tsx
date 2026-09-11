import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2, RotateCcw, X } from 'lucide-react';
import { AuthProvider } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import { clearMiniSession, launchMiniApp, miniAuthApi, syncTelegramTheme, telegramApp } from '@/features/board/telegram';
import { TasksApp } from './TasksApp';
import '@/index.css';
import './miniapp.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: true }, mutations: { retry: false } } });

// The miniapp has no CRM layout around it, so a render crash must land on a
// readable screen instead of a white viewport inside Telegram.
class MiniErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[MiniApp]', error, info); }
  render() {
    if (this.state.error) return <MiniErrorScreen error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

function MiniErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mini-center" role="alert">
      <AlertCircle className="size-10 text-destructive" />
      <h1 className="text-lg font-medium">{t('errorOccurred')}</h1>
      <p className="text-sm text-muted-foreground">{import.meta.env.DEV && error.message ? error.message : t('failedToLoadData')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}><RotateCcw className="mr-2 size-4" />{t('reloadPage')}</Button>
        <Button variant="outline" onClick={onRetry}>{t('retry')}</Button>
      </div>
    </div>
  );
}

function MiniApp() {
  const { t } = useTranslation();
  const [expired, setExpired] = useState(false);
  const launch = useQuery({ queryKey: ['mini-launch'], queryFn: launchMiniApp, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  useEffect(() => {
    document.title = t('miniTasksTitle');
    document.body.classList.add('telegram-tasks');
    const app = telegramApp();
    const theme = () => { if (app) syncTelegramTheme(app); };
    theme();
    app?.ready();
    app?.expand();
    app?.onEvent('themeChanged', theme);
    const expire = () => { clearMiniSession(); setExpired(true); };
    window.addEventListener('miniapp-auth-expired', expire);
    return () => { app?.offEvent('themeChanged', theme); window.removeEventListener('miniapp-auth-expired', expire); };
  }, [t]);
  useEffect(() => { if (launch.data) client.setQueryData(AUTH_SESSION_QUERY_KEY, launch.data); }, [launch.data]);
  if (expired) return (
    <div className="mini-center" role="alert">
      <p>{t('miniTasksSessionExpired')}</p>
      <Button variant="outline" onClick={() => telegramApp()?.close()}><X className="mr-2 size-4" />{t('close')}</Button>
    </div>
  );
  if (launch.isError) return <div className="mini-center" role="alert"><p>{!telegramApp()?.initData ? t('miniTasksOpenTelegram') : (launch.error as { status?: number }).status === 401 ? t('miniTasksSessionExpired') : t('miniTasksUnavailable')}</p><Button variant="outline" onClick={() => void launch.refetch()}><RotateCcw className="mr-2 size-4" />{t('retry')}</Button></div>;
  if (!launch.data) return <div className="mini-center" role="status" aria-label={t('loading')}><Loader2 className="size-7 animate-spin" /><span className="text-sm text-muted-foreground">{t('miniTasksPreparing')}</span></div>;
  return <AuthProvider api={miniAuthApi}><TasksApp /></AuthProvider>;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <TooltipProvider>
      <MiniErrorBoundary>
        <MiniApp />
        <Toaster />
      </MiniErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>,
);
