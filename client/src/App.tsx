import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import Layout from "@/components/Layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import AcademyPage from "@/pages/academy";
import Admin from "@/pages/admin";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">{t('loading')}</p>
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
        <Route path="/" component={() => <AcademyPage section="dashboard" />} />
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
        <Route path="/admin" component={Admin} />
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
