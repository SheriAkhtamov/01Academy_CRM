import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/ux/ThemeProvider';
import { MotionProvider } from '@/components/ux/motion';
import { AppErrorBoundary } from '@/components/ux/AppErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';

/** Portal owns its query/session provider; staff auth and telephony are absent. */
export function PortalProviders({ children }: { children: ReactNode }) {
  return <ThemeProvider defaultTheme="system" storageKey="academy-crm-theme">
    <MotionProvider><TooltipProvider><Toaster /><AppErrorBoundary>{children}</AppErrorBoundary></TooltipProvider></MotionProvider>
  </ThemeProvider>;
}
