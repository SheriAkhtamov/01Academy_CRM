import { lazy, Suspense, type ReactNode } from 'react';
import { Redirect, Switch, Route } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { canAccessAcademyWorkspace, hasFinanceAccess, hasLeadershipAccess, type AcademyWorkspace } from '@shared/academy';
import Layout from '@/components/Layout';

const NotFound = lazy(() => import('@/pages/not-found'));
const Login = lazy(() => import('@/pages/login'));
const AcademyPage = lazy(() => import('@/pages/academy'));
const SalesDashboard = lazy(() => import('@/pages/sales-dashboard'));
const MessagesPage = lazy(() => import('@/pages/sales/InstagramMessagesPage'));
const CallJournalPage = lazy(() => import('@/pages/sales/CallJournalPage'));
const TeacherWorkspace = lazy(() => import('@/pages/teacher-workspace'));
const MarketingWorkspace = lazy(() => import('@/pages/marketing-workspace'));
const Admin = lazy(() => import('@/pages/admin'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AcademySettings = lazy(() => import('@/pages/academy-settings'));
const TasksPage = lazy(() => import('@/pages/tasks'));
const AuditPage = lazy(() => import('@/pages/admin/audit'));
const FinanceCenter = lazy(() => import('@/pages/finance-center'));

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

function AccessDenied({
  titleKey = 'accessDeniedWorkspace',
  descriptionKey,
}: {
  titleKey?: 'accessDeniedWorkspace' | 'noWorkspaceAssigned';
  descriptionKey?: 'financeCenterAccessRequired';
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const title = titleKey === 'noWorkspaceAssigned'
    ? t('noWorkspaceAssigned')
    : t('accessDeniedWorkspace');
  const description = descriptionKey === 'financeCenterAccessRequired'
    ? t('financeCenterAccessRequired')
    : hasLeadershipAccess(user)
      ? t('adminWorkspaceBoundaryDescription')
      : t('contactAdministratorForAccess');

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <div className="rounded-xl border border-border/70 bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function WorkspaceGuard({
  workspace,
  children,
}: {
  workspace: AcademyWorkspace;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !canAccessAcademyWorkspace(user, workspace)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}

function FinanceGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !hasFinanceAccess(user)) {
    return <AccessDenied descriptionKey="financeCenterAccessRequired" />;
  }
  return <>{children}</>;
}

type AcademySection = 'integrations';

const adminPage = (section: AcademySection) => (
  <WorkspaceGuard workspace="administration">
    <AcademyPage section={section} />
  </WorkspaceGuard>
);

function RouteLoading() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-[3px] border-muted border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      </div>
    </div>
  );
}

export function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <Login />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<RouteLoading />}>
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
        <Route path="/sales/task-board" component={() => <Redirect to="/tasks" />} />
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
        <Route path="/sales/tasks" component={() => <Redirect to="/tasks" />} />
        <Route path="/sales/messages" component={() => (
          <WorkspaceGuard workspace="sales">
            <MessagesPage />
          </WorkspaceGuard>
        )} />
        <Route path="/sales/calls" component={() => (
          <WorkspaceGuard workspace="sales">
            <CallJournalPage />
          </WorkspaceGuard>
        )} />
        <Route path="/tasks" component={TasksPage} />
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
        <Route path="/teacher-workspace/tasks" component={() => <Redirect to="/tasks" />} />
        <Route path="/teacher-workspace/ratings" component={() => <Redirect to="/teacher-workspace" />} />
        <Route path="/teacher-workspace/profile" component={() => <Redirect to="/teacher-workspace" />} />
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
        <Route path="/marketing-workspace/tasks" component={() => <Redirect to="/tasks" />} />
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
        <Route path="/finance/income" component={() => (
          <FinanceGuard>
            <FinanceCenter section="income" />
          </FinanceGuard>
        )} />
        <Route path="/finance/expenses" component={() => (
          <FinanceGuard>
            <FinanceCenter section="expenses" />
          </FinanceGuard>
        )} />
        <Route path="/finance/payroll" component={() => (
          <FinanceGuard>
            <FinanceCenter section="payroll" />
          </FinanceGuard>
        )} />
        <Route path="/finance/transactions" component={() => (
          <FinanceGuard>
            <FinanceCenter section="transactions" />
          </FinanceGuard>
        )} />
        <Route path="/finance" component={() => (
          <FinanceGuard>
            <FinanceCenter section="overview" />
          </FinanceGuard>
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
    </Suspense>
  );
}
