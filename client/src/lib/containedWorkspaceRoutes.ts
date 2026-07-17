const CONTAINED_WORKSPACE_ROUTES = new Set([
  '/sales/messages',
  '/sales/task-board',
  '/teacher-workspace/tasks',
  '/marketing-workspace/tasks',
  '/admin/tasks',
]);

export function isContainedWorkspaceRoute(location: string) {
  const pathname = location.split(/[?#]/, 1)[0];
  return CONTAINED_WORKSPACE_ROUTES.has(pathname);
}
