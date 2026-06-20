import { Redirect, Switch, Route } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  ACADEMY_WORKSPACE_ROLES,
  type AcademyRole,
} from '@shared/academy';
import Layout from '@/components/Layout';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import AcademyPage from '@/pages/academy';
import SalesDashboard from '@/pages/sales-dashboard';
import AnalyticsWorkspace from '@/pages/analytics-workspace';
import TeacherWorkspace from '@/pages/teacher-workspace';
import MarketingWorkspace from '@/pages/marketing-workspace';
import Admin from '@/pages/admin';
import AcademySettings from '@/pages/academy-settings';
import ManagementBoard from '@/pages/management';

function RoleBasedHome() {
  const { user } = useAuth();
  switch (user?.role) {
    case 'admin':
    case 'head': return <Admin />;
    case 'account_manager': return <SalesDashboard />;
    case 'teacher': return <TeacherWorkspace />;
    case 'operations_director': return <AnalyticsWorkspace />;
    case 'smm_manager': return <MarketingWorkspace />;
    default: return <AccessDenied titleKey="noWorkspaceAssigned" />;
  }
}

function AccessDenied({ titleKey = 'accessDeniedWorkspace' }: { titleKey?: 'accessDeniedWorkspace' | 'noWorkspaceAssigned' }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const title = titleKey === 'noWorkspaceAssigned'
    ? t('noWorkspaceAssigned')
    : t('accessDeniedWorkspace');
  const description = user?.role === 'admin'
    ? t('adminWorkspaceBoundaryDescription')
    : t('contactAdministratorForAccess');

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <div className="rounded-xl border border-slate-200/70 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: readonly AcademyRole[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !allowedRoles.includes(user.role as AcademyRole)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}

const adminRoles = ACADEMY_WORKSPACE_ROLES.administration;
const salesRoles = ACADEMY_WORKSPACE_ROLES.sales;
const teacherRoles = ACADEMY_WORKSPACE_ROLES.teacher;
const analyticsRoles = ACADEMY_WORKSPACE_ROLES.analytics;
const marketingRoles = ACADEMY_WORKSPACE_ROLES.marketing;
const managementRoles = ACADEMY_WORKSPACE_ROLES.management;

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
        <Route path="/sales/leads" component={() => <Redirect to="/sales/pipeline" />} />
        <Route path="/sales/pipeline" component={() => (
          <RoleGuard allowedRoles={salesRoles}>
            <SalesDashboard section="pipeline" />
          </RoleGuard>
        )} />
        <Route path="/sales/schedule" component={() => (
          <RoleGuard allowedRoles={salesRoles}>
            <SalesDashboard section="schedule" />
          </RoleGuard>
        )} />
        <Route path="/sales/clients" component={() => (
          <RoleGuard allowedRoles={salesRoles}>
            <SalesDashboard section="students" />
          </RoleGuard>
        )} />
        <Route path="/sales/tasks" component={() => (
          <RoleGuard allowedRoles={salesRoles}>
            <SalesDashboard section="tasks" />
          </RoleGuard>
        )} />
        <Route path="/sales" component={() => (
          <RoleGuard allowedRoles={salesRoles}>
            <SalesDashboard section="overview" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace/funnel" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="funnel" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace/courses" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="courses" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace/sources" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="sources" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace/teachers" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="teachers" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace/groups" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="groups" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace/risks" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="risks" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace/cohorts" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="cohorts" />
          </RoleGuard>
        )} />
        <Route path="/analytics-workspace" component={() => (
          <RoleGuard allowedRoles={analyticsRoles}>
            <AnalyticsWorkspace section="overview" />
          </RoleGuard>
        )} />
        <Route path="/teacher-workspace/schedule" component={() => (
          <RoleGuard allowedRoles={teacherRoles}>
            <TeacherWorkspace section="schedule" />
          </RoleGuard>
        )} />
        <Route path="/teacher-workspace/groups" component={() => (
          <RoleGuard allowedRoles={teacherRoles}>
            <TeacherWorkspace section="groups" />
          </RoleGuard>
        )} />
        <Route path="/teacher-workspace/attendance" component={() => (
          <RoleGuard allowedRoles={teacherRoles}>
            <TeacherWorkspace section="attendance" />
          </RoleGuard>
        )} />
        <Route path="/teacher-workspace/ratings" component={() => (
          <RoleGuard allowedRoles={teacherRoles}>
            <TeacherWorkspace section="ratings" />
          </RoleGuard>
        )} />
        <Route path="/teacher-workspace/profile" component={() => (
          <RoleGuard allowedRoles={teacherRoles}>
            <TeacherWorkspace section="profile" />
          </RoleGuard>
        )} />
        <Route path="/teacher-workspace" component={() => (
          <RoleGuard allowedRoles={teacherRoles}>
            <TeacherWorkspace section="overview" />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace/sources" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace section="sources" />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace/funnel" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace section="funnel" />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace/warm-base" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace section="warm" />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace/referrals" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace section="referrals" />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace/expenses" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace section="expenses" />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace/reports" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace section="reports" />
          </RoleGuard>
        )} />
        <Route path="/marketing-workspace" component={() => (
          <RoleGuard allowedRoles={marketingRoles}>
            <MarketingWorkspace section="overview" />
          </RoleGuard>
        )} />
        <Route path="/admin" component={() => (
          <RoleGuard allowedRoles={adminRoles}>
            <Admin />
          </RoleGuard>
        )} />
        <Route path="/employees" component={() => (
          <RoleGuard allowedRoles={adminRoles}>
            <Admin mode="employees" />
          </RoleGuard>
        )} />
        <Route path="/admin/academy-settings" component={() => (
          <RoleGuard allowedRoles={adminRoles}>
            <AcademySettings />
          </RoleGuard>
        )} />
        <Route path="/management" component={() => (
          <RoleGuard allowedRoles={managementRoles}>
            <ManagementBoard />
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
