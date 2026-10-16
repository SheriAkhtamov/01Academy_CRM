import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/ux/ThemeProvider';
import { MotionProvider } from '@/components/ux/motion';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { AppErrorBoundary } from '@/components/ux/AppErrorBoundary';

/** Shared presentation providers for every platform module and the common login. */
export function PlatformProviders({ children }: { children: ReactNode }) {
  return <ThemeProvider defaultTheme="system" storageKey="academy-crm-theme">
    <MotionProvider>
      <TooltipProvider>
        <Toaster />
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </TooltipProvider>
    </MotionProvider>
  </ThemeProvider>;
}
