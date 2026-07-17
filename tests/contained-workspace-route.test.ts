import { describe, expect, it } from 'vitest';
import { isContainedWorkspaceRoute } from '../client/src/lib/containedWorkspaceRoutes';

describe('isContainedWorkspaceRoute', () => {
  it.each([
    '/integrations',
    '/sales/pipeline',
    '/sales/pipeline?lead=42',
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
  ])('keeps the app shell from adding a second scrollbar for %s', (location) => {
    expect(isContainedWorkspaceRoute(location)).toBe(true);
  });

  it.each([
    '/sales',
    '/teacher-workspace',
    '/marketing-workspace',
    '/finance',
    '/admin',
    '/',
  ])('preserves normal page scrolling for %s', (location) => {
    expect(isContainedWorkspaceRoute(location)).toBe(false);
  });
});
