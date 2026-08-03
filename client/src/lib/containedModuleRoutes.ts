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
  '/teacher-module/schedule',
  '/teacher-module/groups',
  '/teacher-module/attendance',
  '/teacher-module/tasks',
  '/marketing-module/sources',
  '/marketing-module/funnel',
  '/marketing-module/warm-base',
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
