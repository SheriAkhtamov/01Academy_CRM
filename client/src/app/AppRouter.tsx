import { lazy, Suspense, type ReactNode } from 'react';
import { Redirect, Switch, Route } from 'wouter';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { canAccessAcademyModule, hasFinanceAccess, hasLeadershipAccess, type AcademyModule } from '@shared/academy';
import Layout, { AppSpinner } from '@/components/Layout';
import { SPRING, scaleIn } from '@/lib/motion';

const NotFound = lazy(() => import('@/pages/not-found'));
const Login = lazy(() => import('@/pages/login'));
const AcademyPage = lazy(() => import('@/pages/academy'));
const SalesDashboard = lazy(() => import('@/pages/sales-dashboard'));
const MessagesPage = lazy(() => import('@/pages/sales/InstagramMessagesPage'));
const CallJournalPage = lazy(() => import('@/pages/sales/CallJournalPage'));
const TeacherModule = lazy(() => import('@/pages/teacher-module'));
const MarketingModule = lazy(() => import('@/pages/marketing-module'));
const Admin = lazy(() => import('@/pages/admin'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AcademySettings = lazy(() => import('@/pages/academy-settings'));
const TasksPage = lazy(() => import('@/pages/tasks'));
const AuditPage = lazy(() => import('@/pages/admin/audit'));
const FinanceCenter = lazy(() => import('@/pages/finance-center'));

function ModuleBasedHome() {
  const { user } = useAuth();
  switch (user?.module) {
    case 'administration':
      return <AdminDashboardPage />;
    case 'sales': return <SalesDashboard />;
    case 'teacher': return <TeacherModule />;
    case 'marketing': return <MarketingModule />;
    default: return <AccessDenied titleKey="noModuleAssigned" />;
  }
}

function AccessDenied({
  titleKey = 'accessDeniedModule',
  descriptionKey,
}: {
  titleKey?: 'accessDeniedModule' | 'noModuleAssigned';
  descriptionKey?: 'financeCenterAccessRequired';
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const title = titleKey === 'noModuleAssigned'
    ? t('noModuleAssigned')
    : t('accessDeniedModule');
  const description = descriptionKey === 'financeCenterAccessRequired'
    ? t('financeCenterAccessRequired')
    : hasLeadershipAccess(user)
      ? t('adminModuleBoundaryDescription')
      : t('contactAdministratorForAccess');

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <motion.div
        className="rounded-xl border border-border/70 bg-card p-8 text-center"
        variants={scaleIn}
        initial="hidden"
        animate="visible"
        transition={SPRING.gentle}
      >
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </motion.div>
    </div>
  );
}

function ModuleGuard({
  module,
  children,
}: {
  module: AcademyModule;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !canAccessAcademyModule(user, module)) {
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
  <ModuleGuard module="administration">
    <AcademyPage section={section} />
  </ModuleGuard>
);

function RouteLoading() {
  const { t } = useTranslation();

  return <AppSpinner label={t('loading')} />;
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
        <Route path="/" component={ModuleBasedHome} />
        <Route path="/integrations" component={() => adminPage('integrations')} />
        <Route path="/sales/leads" component={() => <Redirect to="/sales/pipeline" />} />
        <Route path="/sales/pipeline" component={() => (
          <ModuleGuard module="sales">
            <SalesDashboard section="pipeline" />
          </ModuleGuard>
        )} />
        <Route path="/sales/task-board" component={() => <Redirect to="/tasks" />} />
        <Route path="/sales/archive" component={() => (
          <ModuleGuard module="sales">
            <SalesDashboard section="archive" />
          </ModuleGuard>
        )} />
        <Route path="/sales/schedule" component={() => (
          <ModuleGuard module="sales">
            <SalesDashboard section="schedule" />
          </ModuleGuard>
        )} />
        <Route path="/sales/clients" component={() => (
          <ModuleGuard module="sales">
            <SalesDashboard section="students" />
          </ModuleGuard>
        )} />
        <Route path="/sales/tasks" component={() => <Redirect to="/tasks" />} />
        <Route path="/sales/messages" component={() => (
          <ModuleGuard module="sales">
            <MessagesPage />
          </ModuleGuard>
        )} />
        <Route path="/sales/calls" component={() => (
          <ModuleGuard module="sales">
            <CallJournalPage />
          </ModuleGuard>
        )} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/sales" component={() => (
          <ModuleGuard module="sales">
            <SalesDashboard section="overview" />
          </ModuleGuard>
        )} />
        <Route path="/teacher-module/schedule" component={() => (
          <ModuleGuard module="teacher">
            <TeacherModule section="schedule" />
          </ModuleGuard>
        )} />
        <Route path="/teacher-module/groups" component={() => (
          <ModuleGuard module="teacher">
            <TeacherModule section="groups" />
          </ModuleGuard>
        )} />
        <Route path="/teacher-module/attendance" component={() => (
          <ModuleGuard module="teacher">
            <TeacherModule section="attendance" />
          </ModuleGuard>
        )} />
        <Route path="/teacher-module/tasks" component={() => <Redirect to="/tasks" />} />
        <Route path="/teacher-module/ratings" component={() => (
          <ModuleGuard module="teacher">
            <TeacherModule section="ratings" />
          </ModuleGuard>
        )} />
        <Route path="/teacher-module/profile" component={() => <Redirect to="/teacher-module" />} />
        <Route path="/teacher-module" component={() => (
          <ModuleGuard module="teacher">
            <TeacherModule section="overview" />
          </ModuleGuard>
        )} />
        <Route path="/marketing-module/sources" component={() => (
          <ModuleGuard module="marketing">
            <MarketingModule section="sources" />
          </ModuleGuard>
        )} />
        <Route path="/marketing-module/funnel" component={() => (
          <ModuleGuard module="marketing">
            <MarketingModule section="funnel" />
          </ModuleGuard>
        )} />
        <Route path="/marketing-module/referrals" component={() => (
          <ModuleGuard module="marketing">
            <MarketingModule section="referrals" />
          </ModuleGuard>
        )} />
        <Route path="/marketing-module/tasks" component={() => <Redirect to="/tasks" />} />
        <Route path="/marketing-module/expenses" component={() => (
          <ModuleGuard module="marketing">
            <MarketingModule section="expenses" />
          </ModuleGuard>
        )} />
        <Route path="/marketing-module/meta-attribution" component={() => (
          <ModuleGuard module="marketing">
            <MarketingModule section="meta-attribution" />
          </ModuleGuard>
        )} />
        <Route path="/marketing-module/meta-events" component={() => (
          <ModuleGuard module="marketing">
            <MarketingModule section="meta-events" />
          </ModuleGuard>
        )} />
        <Route path="/marketing-module" component={() => (
          <ModuleGuard module="marketing">
            <MarketingModule section="overview" />
          </ModuleGuard>
        )} />
        <Route path="/admin" component={() => (
          <ModuleGuard module="administration">
            <AdminDashboardPage />
          </ModuleGuard>
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
          <ModuleGuard module="administration">
            <Admin mode="employees" />
          </ModuleGuard>
        )} />
        <Route path="/admin/sales-settings" component={() => (
          <ModuleGuard module="administration">
            <AcademySettings mode="sales" />
          </ModuleGuard>
        )} />
        <Route path="/admin/leads" component={() => <Redirect to="/admin/sales-settings" />} />
        <Route path="/admin/tasks" component={() => <Redirect to="/tasks" />} />
        <Route path="/admin/academy-settings" component={() => (
          <ModuleGuard module="administration">
            <AcademySettings />
          </ModuleGuard>
        )} />
        <Route path="/admin/audit" component={() => (
          <ModuleGuard module="administration">
            <AuditPage />
          </ModuleGuard>
        )} />
        <Route component={NotFound} />
        </Switch>
      </Layout>
    </Suspense>
  );
}
