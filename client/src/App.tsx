import { initializeNavigationGuard } from '@/lib/navigationGuard';
import { AppProviders } from '@/app/AppProviders';
import { AppRouter } from '@/app/AppRouter';
import { useLocation } from 'wouter';
import { PublicAttendanceApp } from '@/app/PublicAttendanceApp';

initializeNavigationGuard();

export default function App() {
  const [location] = useLocation();
  if (location === '/b2b-attendance' || location === '/b2b-attendance/') return <PublicAttendanceApp />;
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
