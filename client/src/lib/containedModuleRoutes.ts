const CONTAINED_MODULE_ROUTES = new Set([
  '/integrations',
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

export function isContainedModuleRoute(location: string) {
  const pathname = location.split(/[?#]/, 1)[0];
  return CONTAINED_MODULE_ROUTES.has(pathname);
}
