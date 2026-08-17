import type { AcademyModule } from '@shared/academy';

const CONTAINED_MODULE_ROUTES = new Set([
  '/sales/pipeline',
  '/sales/archive',
  '/sales/schedule',
  '/sales/clients',
  '/sales/tasks',
  '/sales/messages',
  '/sales/calls',
  '/sales/task-board',
  // The teacher overview is a work desk, not a report: it owns its scroll like
  // the other four sections so switching between them does not change the
  // content width or which element scrolls.
  '/teacher-module',
  '/teacher-module/schedule',
  '/teacher-module/groups',
  '/teacher-module/attendance',
  '/teacher-module/tasks',
  '/marketing-module/sources',
  '/marketing-module/funnel',
  '/marketing-module/referrals',
  '/marketing-module/expenses',
  '/marketing-module/meta-attribution',
  '/marketing-module/meta-events',
  '/marketing-module/tasks',
  '/finance/income',
  '/finance/expenses',
  '/finance/payroll',
  '/finance/transactions',
  '/employees',
  '/admin/sales-settings',
  '/admin/tasks',
  '/admin/academy-settings',
  '/admin/audit',
  '/tasks',
]);

/**
 * `/` renders whichever module the operator works in, so the path alone cannot
 * say whether the page builds its own scroll area. The teacher module is
 * contained in every section, overview included, and a teacher lands on `/`
 * after signing in — without this it would get the same page with different
 * padding, a different content width and a different element under the finger
 * than `/teacher-module`, which is the mismatch the route table above exists
 * to prevent. Every other module opens its overview on `/`, and those scroll
 * with the document.
 */
const CONTAINED_HOME_MODULES = new Set<AcademyModule>(['teacher']);

export function isContainedModuleRoute(location: string, homeModule?: AcademyModule | null) {
  const pathname = location.split(/[?#]/, 1)[0];
  if (pathname === '/') return homeModule ? CONTAINED_HOME_MODULES.has(homeModule) : false;
  return CONTAINED_MODULE_ROUTES.has(pathname);
}
