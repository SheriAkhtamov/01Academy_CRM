import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/hooks/useAuth';
import { TelephonyProvider, useTelephony } from '@/contexts/TelephonyContext';
import { AppErrorBoundary } from '@/components/ux/AppErrorBoundary';
import { EmployeeIdentityProvider } from '@/features/employees/EmployeeIdentityProvider';
import { EmployeeCardProvider } from '@/features/employees/EmployeeCardProvider';

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

export function AppProviders({ children, telephony = true }: { children: ReactNode; telephony?: boolean }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <EmployeeIdentityProvider>
        <EmployeeCardProvider>
        {telephony ? <TelephonyProvider>
          {children}
          <AppErrorBoundary variant="widget">
            <TelephonyOverlay />
          </AppErrorBoundary>
        </TelephonyProvider> : children}
        </EmployeeCardProvider>
        </EmployeeIdentityProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
