import { useQuery } from '@tanstack/react-query';
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

function LayoutWithSearch({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<any>({
    queryKey: ['/api/academy/bootstrap'],
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });

  const searchData = data
    ? {
        leads: data.leads,
        students: data.students,
        courses: data.courses,
        groups: data.groups,
        teachers: data.teachers,
        sources: data.sources,
      }
    : undefined;

  return <Layout searchData={searchData}>{children}</Layout>;
}

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
const salesRoles: AcademyRole[] = ['account_manager', 'admin', 'head'];
const teacherRoles: AcademyRole[] = ['teacher', 'admin', 'head'];
const analyticsRoles: AcademyRole[] = ['operations_director', 'admin', 'head'];
const marketingRoles: AcademyRole[] = ['smm_manager', 'admin', 'head'];

type AcademySection =
  | 'dashboard'
  | 'leads'
  | 'pipeline'
  | 'students'
  | 'courses'
  | 'groups'
  | 'lessons'
  | 'teachers'
  | 'attendance'
  | 'payments'
  | 'finance'
  | 'analytics'
  | 'risks'
  | 'warm-base'
  | 'referrals'
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
    <LayoutWithSearch>
      <Switch>
        <Route path="/" component={RoleBasedHome} />
        <Route path="/leads" component={() => adminPage('leads')} />
        <Route path="/pipeline" component={() => adminPage('pipeline')} />
        <Route path="/students" component={() => adminPage('students')} />
        <Route path="/courses" component={() => adminPage('courses')} />
        <Route path="/groups" component={() => adminPage('groups')} />
        <Route path="/lessons" component={() => adminPage('lessons')} />
        <Route path="/teachers" component={() => adminPage('teachers')} />
        <Route path="/attendance" component={() => adminPage('attendance')} />
        <Route path="/payments" component={() => adminPage('payments')} />
        <Route path="/finance" component={() => adminPage('finance')} />
        <Route path="/analytics" component={() => adminPage('analytics')} />
        <Route path="/risks" component={() => adminPage('risks')} />
        <Route path="/warm-base" component={() => adminPage('warm-base')} />
        <Route path="/referrals" component={() => adminPage('referrals')} />
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
            <Admin />
          </RoleGuard>
        )} />
        <Route component={NotFound} />
      </Switch>
    </LayoutWithSearch>
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
