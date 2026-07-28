import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { TelephonyProvider } from '@/contexts/TelephonyContext';
import { TelephonyWidget } from '@/components/telephony/TelephonyWidget';
import { ThemeProvider } from '@/components/ux/ThemeProvider';
import { AppErrorBoundary } from '@/components/ux/AppErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';

const TelephonyOverlay = () => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <TelephonyWidget /> : null;
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
