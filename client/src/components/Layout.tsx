import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useLocation } from 'wouter';
import Sidebar from './Sidebar';
import Header from './Header';
import { ThemeProvider } from './ux/ThemeProvider';

interface LayoutProps {
  children: React.ReactNode;
}

function LayoutInner({ children }: LayoutProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useWebSocket();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-[3px] border-slate-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 md:hidden animate-fadeIn"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-out md:relative md:translate-x-0 md:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header onMenuToggle={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-auto">
          <div key={location} className="page-enter min-w-0 max-w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Layout({ children }: LayoutProps) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="academy-crm-theme">
      <LayoutInner>{children}</LayoutInner>
    </ThemeProvider>
  );
}
