import { lazy, Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/ux/ThemeProvider';
import { useTranslation } from '@/hooks/useTranslation';

const PublicAttendancePage = lazy(() => import('@/pages/public-attendance'));

export function PublicAttendanceApp() {
  const { t } = useTranslation();
  const [client] = useState(() => new QueryClient({ defaultOptions: {
    queries: { retry: false, staleTime: 0, refetchOnWindowFocus: true }, mutations: { retry: false },
  } }));
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <Suspense fallback={<div role="status" className="grid min-h-dvh place-items-center bg-background text-foreground">{t('loading')}</div>}>
          <PublicAttendancePage />
        </Suspense>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
