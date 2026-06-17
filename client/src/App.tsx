import { useQuery } from '@tanstack/react-query';
import { Switch, Route } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
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
    case 'account_manager': return <SalesDashboard />;
    case 'teacher': return <TeacherWorkspace />;
    case 'operations_director': return <AnalyticsWorkspace />;
    case 'smm_manager': return <MarketingWorkspace />;
    default: return <AcademyPage section="dashboard" />;
  }
}

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
        <Route path="/leads" component={() => <AcademyPage section="leads" />} />
        <Route path="/pipeline" component={() => <AcademyPage section="pipeline" />} />
        <Route path="/students" component={() => <AcademyPage section="students" />} />
        <Route path="/courses" component={() => <AcademyPage section="courses" />} />
        <Route path="/groups" component={() => <AcademyPage section="groups" />} />
        <Route path="/lessons" component={() => <AcademyPage section="lessons" />} />
        <Route path="/teachers" component={() => <AcademyPage section="teachers" />} />
        <Route path="/attendance" component={() => <AcademyPage section="attendance" />} />
        <Route path="/payments" component={() => <AcademyPage section="payments" />} />
        <Route path="/finance" component={() => <AcademyPage section="finance" />} />
        <Route path="/analytics" component={() => <AcademyPage section="analytics" />} />
        <Route path="/risks" component={() => <AcademyPage section="risks" />} />
        <Route path="/warm-base" component={() => <AcademyPage section="warm-base" />} />
        <Route path="/referrals" component={() => <AcademyPage section="referrals" />} />
        <Route path="/integrations" component={() => <AcademyPage section="integrations" />} />
        <Route path="/settings" component={() => <AcademyPage section="settings" />} />
        <Route path="/sales" component={SalesDashboard} />
        <Route path="/analytics-workspace" component={AnalyticsWorkspace} />
        <Route path="/teacher-workspace" component={TeacherWorkspace} />
        <Route path="/marketing-workspace" component={MarketingWorkspace} />
        <Route path="/admin" component={Admin} />
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
