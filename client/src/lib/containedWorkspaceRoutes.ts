const CONTAINED_WORKSPACE_ROUTES = new Set([
  '/integrations',
  '/sales/pipeline',
  '/sales/archive',
  '/sales/schedule',
  '/sales/clients',
  '/sales/tasks',
  '/sales/messages',
  '/sales/task-board',
  '/teacher-workspace/schedule',
  '/teacher-workspace/groups',
  '/teacher-workspace/attendance',
  '/teacher-workspace/tasks',
  '/marketing-workspace/sources',
  '/marketing-workspace/funnel',
  '/marketing-workspace/warm-base',
  '/marketing-workspace/referrals',
  '/marketing-workspace/expenses',
  '/marketing-workspace/tasks',
  '/finance/income',
  '/finance/expenses',
  '/finance/payroll',
  '/finance/transactions',
  '/employees',
  '/admin/sales-settings',
  '/admin/tasks',
  '/admin/academy-settings',
  '/admin/audit',
]);

export function isContainedWorkspaceRoute(location: string) {
  const pathname = location.split(/[?#]/, 1)[0];
  return CONTAINED_WORKSPACE_ROUTES.has(pathname);
}
