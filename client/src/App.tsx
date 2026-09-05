import { initializeNavigationGuard } from '@/lib/navigationGuard';
import { AppProviders } from '@/app/AppProviders';
import { AppRouter } from '@/app/AppRouter';

initializeNavigationGuard();

export default function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
