import { initializeNavigationGuard } from '@/lib/navigationGuard';
import { useLocation } from 'wouter';
import { PublicAttendanceApp } from '@/app/PublicAttendanceApp';
import { PlatformProviders } from '@/app/PlatformProviders';
import { PlatformRouter } from '@/app/PlatformRouter';

initializeNavigationGuard();

export default function App() {
  const [location] = useLocation();
  if (location === '/b2b-attendance' || location === '/b2b-attendance/') return <PublicAttendanceApp />;
  return <PlatformProviders><PlatformRouter /></PlatformProviders>;
}
