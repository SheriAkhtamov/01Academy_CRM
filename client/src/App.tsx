import { Switch, Route } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { AcademyRole } from '@shared/academy';
import Layout from '@/components/Layout';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import AcademyPage from '@/pages/academy';
import SalesDashboard from '@/pages/sales-dashboard';
import AnalyticsWorkspace from '@/pages/analytics-workspace';
import TeacherWorkspace from '@/pages/teacher-workspace';
import MarketingWorkspace from '@/pages/marketing-workspace';
import Admin from '@/pages/admin';

function RoleBasedHome() {
  const { user } = useAuth();
  switch (user?.role) {
    case 'admin':
    case 'head': return <Admin mode="admin" />;
    case 'account_manager': return <SalesDashboard />;
    case 'teacher': return <TeacherWorkspace />;
    case 'operations_director': return <AnalyticsWorkspace />;
    case 'smm_manager': return <MarketingWorkspace />;
    default: return <AccessDenied titleKey="noWorkspaceAssigned" />;
  }
}

function AccessDenied({ titleKey = 'accessDeniedWorkspace' }: { titleKey?: 'accessDeniedWorkspace' | 'noWorkspaceAssigned' }) {
  const { t } = useTranslation();
  const title = titleKey === 'noWorkspaceAssigned'
    ? t('noWorkspaceAssigned')
    : t('accessDeniedWorkspace');

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <div className="rounded-xl border border-slate-200/70 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('contactAdministratorForAccess')}</p>
      </div>
    </div>
  );
}

function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: AcademyRole[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !allowedRoles.includes(user.role as AcademyRole)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}

const adminRoles: AcademyRole[] = ['admin', 'head'];
const salesRoles: AcademyRole[] = ['account_manager'];
const teacherRoles: AcademyRole[] = ['teacher'];
const analyticsRoles: AcademyRole[] = ['operations_director'];
const marketingRoles: AcademyRole[] = ['smm_manager'];

type AcademySection =
  | 'integrations'
  | 'settings';

const adminPage = (section: AcademySection) => (
  <RoleGuard allowedRoles={adminRoles}>
    <AcademyPage section={section} />
  </RoleGuard>
);

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();

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
    return <Login />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={RoleBasedHome} />
        <Route path="/integrations" component={() => adminPage('integrations')} />
        <Route path="/settings" component={() => adminPage('settings')} />
        <Route path="/sales" component={() => (
          <RoleGuard allowedRoles={salesRoles}>
            <SalesDashboard />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace />
          </RoleGuard>
        )} />
        <Route path="/teacher-workspace" component={() => (
          <RoleGuard allowedRoles={teacherRoles}>
            <TeacherWorkspace />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace />
          </RoleGuard>
        )} />
        <Route path="/admin" component={() => (
          <RoleGuard allowedRoles={adminRoles}>
            <Admin mode="admin" />
          </RoleGuard>
        )} />
        <Route path="/employees" component={() => (
          <RoleGuard allowedRoles={adminRoles}>
            <Admin mode="employees" />
          </RoleGuard>
        )} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
