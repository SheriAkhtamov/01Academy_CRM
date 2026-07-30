import { describe, expect, it } from 'vitest';
import { isContainedModuleRoute } from '../client/src/lib/containedModuleRoutes';

describe('isContainedModuleRoute', () => {
  it.each([
    '/integrations',
    '/sales/pipeline',
    '/sales/pipeline?lead=42',
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
    '/tasks?task=42',
  ])('keeps the app shell from adding a second scrollbar for %s', (location) => {
    expect(isContainedModuleRoute(location)).toBe(true);
  });

  it.each([
    '/sales',
    '/teacher-module',
    '/marketing-module',
    '/finance',
    '/admin',
    '/',
  ])('preserves normal page scrolling for %s', (location) => {
    expect(isContainedModuleRoute(location)).toBe(false);
  });
});
