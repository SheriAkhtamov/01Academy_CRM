import { lazy, Suspense, type ReactNode } from 'react';
import { Redirect, Switch, Route } from 'wouter';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { canAccessAcademyModule, hasFinanceAccess, type AcademyModule } from '@shared/academy';
import Layout, { AppSpinner } from '@/components/Layout';
import { SPRING, scaleIn } from '@/lib/motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
const SystemManagementPage = lazy(() => import('@/pages/admin/SystemManagementPage'));
const FinanceCenter = lazy(() => import('@/pages/finance-center'));
const ResourcePage = lazy(() => import('@/pages/resource'));

function ModuleBasedHome() {
  const { user } = useAuth();
  switch (user?.module) {
    case 'administration':
      return <AdminDashboardPage />;
    case 'sales': return <SalesDashboard />;
    case 'teacher': return <TeacherModule />;
    case 'marketing': return <MarketingModule />;
    case 'finance': return <FinanceCenter />;
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
  const { t } = useTranslation();
  const title = titleKey === 'noModuleAssigned'
    ? t('noModuleAssigned')
    : t('accessDeniedModule');
  const description = descriptionKey === 'financeCenterAccessRequired'
    ? t('financeCenterAccessRequired')
    : undefined;

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
        {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
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
  const { isAuthenticated, isLoading, isSessionError, isRefetchingSession, refetchSession } = useAuth();
  const { t } = useTranslation();

  if (isSessionError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>{t('sessionCheckFailedTitle')}</AlertTitle>
          <AlertDescription>
            <Button className="mt-4" variant="outline" disabled={isRefetchingSession} onClick={() => void refetchSession().catch(() => undefined)}>
              {isRefetchingSession ? t('loading') : t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

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
        <Route path="/help" children={<ResourcePage resource="help" />} />
        <Route path="/support" children={<ResourcePage resource="support" />} />
        <Route path="/updates" children={<ResourcePage resource="updates" />} />
        <Route path="/integrations" children={<Redirect to="/admin/system-management/integrations" />} />
        <Route path="/sales/leads" children={<Redirect to="/sales/pipeline" />} />
        <Route path="/sales/pipeline" children={
          <ModuleGuard module="sales">
            <SalesDashboard section="pipeline" />
          </ModuleGuard>
        } />
        <Route path="/sales/task-board" children={<Redirect to="/tasks" />} />
        <Route path="/sales/archive" children={
          <ModuleGuard module="sales">
            <SalesDashboard section="archive" />
          </ModuleGuard>
        } />
        <Route path="/sales/schedule" children={
          <ModuleGuard module="sales">
            <SalesDashboard section="schedule" />
          </ModuleGuard>
        } />
        <Route path="/sales/clients" children={
          <ModuleGuard module="sales">
            <SalesDashboard section="students" />
          </ModuleGuard>
        } />
        <Route path="/sales/tasks" children={<Redirect to="/tasks" />} />
        <Route path="/sales/messages" children={
          <ModuleGuard module="sales">
            <MessagesPage />
          </ModuleGuard>
        } />
        <Route path="/sales/calls" children={
          <ModuleGuard module="sales">
            <CallJournalPage />
          </ModuleGuard>
        } />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/sales" children={
          <ModuleGuard module="sales">
            <SalesDashboard section="overview" />
          </ModuleGuard>
        } />
        <Route path="/teacher-module/schedule" children={
          <ModuleGuard module="teacher">
            <TeacherModule section="schedule" />
          </ModuleGuard>
        } />
        <Route path="/teacher-module/groups" children={
          <ModuleGuard module="teacher">
            <TeacherModule section="groups" />
          </ModuleGuard>
        } />
        <Route path="/teacher-module/attendance" children={
          <ModuleGuard module="teacher">
            <TeacherModule section="attendance" />
          </ModuleGuard>
        } />
        <Route path="/teacher-module/tasks" children={<Redirect to="/tasks" />} />
        <Route path="/teacher-module/ratings" children={<Redirect to="/teacher-module" />} />
        <Route path="/teacher-module/profile" children={<Redirect to="/teacher-module" />} />
        <Route path="/teacher-module" children={
          <ModuleGuard module="teacher">
            <TeacherModule section="overview" />
          </ModuleGuard>
        } />
        <Route path="/marketing-module/sources" children={
          <ModuleGuard module="marketing">
            <MarketingModule section="sources" />
          </ModuleGuard>
        } />
        <Route path="/marketing-module/funnel" children={
          <ModuleGuard module="marketing">
            <MarketingModule section="funnel" />
          </ModuleGuard>
        } />
        <Route path="/marketing-module/referrals" children={<Redirect to="/marketing-module" />} />
        <Route path="/marketing-module/tasks" children={<Redirect to="/tasks" />} />
        <Route path="/marketing-module/expenses" children={<Redirect to="/marketing-module" />} />
        <Route path="/marketing-module/meta-attribution" children={
          <ModuleGuard module="marketing">
            <MarketingModule section="meta-attribution" />
          </ModuleGuard>
        } />
        <Route path="/marketing-module/meta-events" children={
          <ModuleGuard module="marketing">
            <MarketingModule section="meta-events" />
          </ModuleGuard>
        } />
        <Route path="/marketing-module" children={
          <ModuleGuard module="marketing">
            <MarketingModule section="overview" />
          </ModuleGuard>
        } />
        <Route path="/admin" children={
          <ModuleGuard module="administration">
            <AdminDashboardPage />
          </ModuleGuard>
        } />
        <Route path="/finance/income" children={
          <FinanceGuard>
            <FinanceCenter section="income" />
          </FinanceGuard>
        } />
        <Route path="/finance/expenses" children={
          <FinanceGuard>
            <FinanceCenter section="expenses" />
          </FinanceGuard>
        } />
        <Route path="/finance/payroll" children={
          <FinanceGuard>
            <FinanceCenter section="payroll" />
          </FinanceGuard>
        } />
        <Route path="/finance/transactions" children={
          <FinanceGuard>
            <FinanceCenter section="transactions" />
          </FinanceGuard>
        } />
        <Route path="/finance" children={
          <FinanceGuard>
            <FinanceCenter section="overview" />
          </FinanceGuard>
        } />
        <Route path="/employees" children={
          <ModuleGuard module="administration">
            <Admin mode="employees" />
          </ModuleGuard>
        } />
        <Route path="/admin/sales-settings" children={
          <ModuleGuard module="administration">
            <AcademySettings mode="sales" />
          </ModuleGuard>
        } />
        <Route path="/admin/leads" children={<Redirect to="/admin/sales-settings" />} />
        <Route path="/admin/tasks" children={<Redirect to="/tasks" />} />
        <Route path="/admin/academy-settings" children={
          <ModuleGuard module="administration">
            <AcademySettings />
          </ModuleGuard>
        } />
        <Route path="/admin/audit" children={<Redirect to="/admin/system-management/audit" />} />
        <Route path="/admin/system-management/audit" children={
          <ModuleGuard module="administration">
            <AuditPage />
          </ModuleGuard>
        } />
        <Route path="/admin/system-management/integrations" children={adminPage('integrations')} />
        <Route path="/admin/system-management/employee-notifications" children={
          <ModuleGuard module="administration">
            <SystemManagementPage section="employee-notifications" />
          </ModuleGuard>
        } />
        <Route path="/admin/system-management" children={
          <ModuleGuard module="administration">
            <SystemManagementPage />
          </ModuleGuard>
        } />
        <Route component={NotFound} />
        </Switch>
      </Layout>
    </Suspense>
  );
}
