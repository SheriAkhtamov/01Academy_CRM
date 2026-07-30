import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/hooks/useAuth';
import { TelephonyProvider, useTelephony } from '@/contexts/TelephonyContext';
import { ThemeProvider } from '@/components/ux/ThemeProvider';
import { AppErrorBoundary } from '@/components/ux/AppErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';

const TelephonyWidget = lazy(() => (
  import('@/components/telephony/TelephonyWidget')
    .then((module) => ({ default: module.TelephonyWidget }))
));

const TelephonyOverlay = () => {
  const { isManagerAssigned } = useTelephony();
  return isManagerAssigned ? (
    <Suspense fallback={null}>
      <TelephonyWidget />
    </Suspense>
  ) : null;
};

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="academy-crm-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TelephonyProvider>
            <TooltipProvider>
              <Toaster />
              <AppErrorBoundary>
                {children}
                <TelephonyOverlay />
              </AppErrorBoundary>
            </TooltipProvider>
          </TelephonyProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
