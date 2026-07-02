import { Redirect, Switch, Route } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { canAccessAcademyWorkspace, hasLeadershipAccess, type AcademyWorkspace } from '@shared/academy';
import Layout from '@/components/Layout';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import AcademyPage from '@/pages/academy';
import SalesDashboard from '@/pages/sales-dashboard';
import MessagesPage from '@/pages/sales/InstagramMessagesPage';
import TeacherWorkspace from '@/pages/teacher-workspace';
import MarketingWorkspace from '@/pages/marketing-workspace';
import Admin from '@/pages/admin';
import AdminDashboardPage from '@/pages/admin/AdminDashboardPage';
import AcademySettings from '@/pages/academy-settings';
import AdminTasksPage from '@/pages/admin/tasks';
import AuditPage from '@/pages/admin/audit';
import { ThemeProvider } from '@/components/ux/ThemeProvider';

function WorkspaceBasedHome() {
  const { user } = useAuth();
  switch (user?.workspace) {
    case 'administration':
      return <AdminDashboardPage />;
    case 'sales': return <SalesDashboard />;
    case 'teacher': return <TeacherWorkspace />;
    case 'marketing': return <MarketingWorkspace />;
    default: return <AccessDenied titleKey="noWorkspaceAssigned" />;
  }
}

function AccessDenied({ titleKey = 'accessDeniedWorkspace' }: { titleKey?: 'accessDeniedWorkspace' | 'noWorkspaceAssigned' }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const title = titleKey === 'noWorkspaceAssigned'
    ? t('noWorkspaceAssigned')
    : t('accessDeniedWorkspace');
  const description = hasLeadershipAccess(user)
    ? t('adminWorkspaceBoundaryDescription')
    : t('contactAdministratorForAccess');

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <div className="rounded-xl border border-border/70 bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function WorkspaceGuard({
  workspace,
  children,
}: {
  workspace: AcademyWorkspace;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !canAccessAcademyWorkspace(user, workspace)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}

type AcademySection = 'integrations';

const adminPage = (section: AcademySection) => (
  <WorkspaceGuard workspace="administration">
    <AcademyPage section={section} />
  </WorkspaceGuard>
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
        <Route path="/" component={WorkspaceBasedHome} />
        <Route path="/integrations" component={() => adminPage('integrations')} />
        <Route path="/sales/leads" component={() => <Redirect to="/sales/pipeline" />} />
        <Route path="/sales/pipeline" component={() => (
          <WorkspaceGuard workspace="sales">
            <SalesDashboard section="pipeline" />
          </WorkspaceGuard>
        )} />
        <Route path="/sales/archive" component={() => (
          <WorkspaceGuard workspace="sales">
            <SalesDashboard section="archive" />
          </WorkspaceGuard>
        )} />
        <Route path="/sales/schedule" component={() => (
          <WorkspaceGuard workspace="sales">
            <SalesDashboard section="schedule" />
          </WorkspaceGuard>
        )} />
        <Route path="/sales/clients" component={() => (
          <WorkspaceGuard workspace="sales">
            <SalesDashboard section="students" />
          </WorkspaceGuard>
        )} />
        <Route path="/sales/tasks" component={() => (
          <WorkspaceGuard workspace="sales">
            <SalesDashboard section="tasks" />
          </WorkspaceGuard>
        )} />
        <Route path="/sales/messages" component={() => (
          <WorkspaceGuard workspace="sales">
            <MessagesPage />
          </WorkspaceGuard>
        )} />
        <Route path="/tasks" component={AdminTasksPage} />
        <Route path="/sales" component={() => (
          <WorkspaceGuard workspace="sales">
            <SalesDashboard section="overview" />
          </WorkspaceGuard>
        )} />
        <Route path="/teacher-workspace/schedule" component={() => (
          <WorkspaceGuard workspace="teacher">
            <TeacherWorkspace section="schedule" />
          </WorkspaceGuard>
        )} />
        <Route path="/teacher-workspace/groups" component={() => (
          <WorkspaceGuard workspace="teacher">
            <TeacherWorkspace section="groups" />
          </WorkspaceGuard>
        )} />
        <Route path="/teacher-workspace/attendance" component={() => (
          <WorkspaceGuard workspace="teacher">
            <TeacherWorkspace section="attendance" />
          </WorkspaceGuard>
        )} />
        <Route path="/teacher-workspace/ratings" component={() => <Redirect to="/teacher-workspace/profile" />} />
        <Route path="/teacher-workspace/profile" component={() => (
          <WorkspaceGuard workspace="teacher">
            <TeacherWorkspace section="profile" />
          </WorkspaceGuard>
        )} />
        <Route path="/teacher-workspace" component={() => (
          <WorkspaceGuard workspace="teacher">
            <TeacherWorkspace section="overview" />
          </WorkspaceGuard>
        )} />
        <Route path="/marketing-workspace/sources" component={() => (
          <WorkspaceGuard workspace="marketing">
            <MarketingWorkspace section="sources" />
          </WorkspaceGuard>
        )} />
        <Route path="/marketing-workspace/funnel" component={() => (
          <WorkspaceGuard workspace="marketing">
            <MarketingWorkspace section="funnel" />
          </WorkspaceGuard>
        )} />
        <Route path="/marketing-workspace/warm-base" component={() => (
          <WorkspaceGuard workspace="marketing">
            <MarketingWorkspace section="warm" />
          </WorkspaceGuard>
        )} />
        <Route path="/marketing-workspace/referrals" component={() => (
          <WorkspaceGuard workspace="marketing">
            <MarketingWorkspace section="referrals" />
          </WorkspaceGuard>
        )} />
        <Route path="/marketing-workspace/expenses" component={() => (
          <WorkspaceGuard workspace="marketing">
            <MarketingWorkspace section="expenses" />
          </WorkspaceGuard>
        )} />
        <Route path="/marketing-workspace" component={() => (
          <WorkspaceGuard workspace="marketing">
            <MarketingWorkspace section="overview" />
          </WorkspaceGuard>
        )} />
        <Route path="/admin" component={() => (
          <WorkspaceGuard workspace="administration">
            <AdminDashboardPage />
          </WorkspaceGuard>
        )} />
        <Route path="/employees" component={() => (
          <WorkspaceGuard workspace="administration">
            <Admin mode="employees" />
          </WorkspaceGuard>
        )} />
        <Route path="/admin/sales-settings" component={() => (
          <WorkspaceGuard workspace="administration">
            <AcademySettings mode="sales" />
          </WorkspaceGuard>
        )} />
        <Route path="/admin/leads" component={() => <Redirect to="/admin/sales-settings" />} />
        <Route path="/admin/tasks" component={() => <Redirect to="/tasks" />} />
        <Route path="/admin/academy-settings" component={() => (
          <WorkspaceGuard workspace="administration">
            <AcademySettings />
          </WorkspaceGuard>
        )} />
        <Route path="/admin/audit" component={() => (
          <WorkspaceGuard workspace="administration">
            <AuditPage />
          </WorkspaceGuard>
        )} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="academy-crm-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
