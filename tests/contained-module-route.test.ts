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
    // Every teacher section, overview included, is a contained module page:
    // the width of the content and the element that scrolls must not change
    // when the user moves between sections of the same module.
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
    '/tasks?task=42',
  ])('keeps the app shell from adding a second scrollbar for %s', (location) => {
    expect(isContainedModuleRoute(location)).toBe(true);
  });

  it.each([
    '/sales',
    '/marketing-module',
    '/finance',
    '/admin',
    '/',
  ])('preserves normal page scrolling for %s', (location) => {
    expect(isContainedModuleRoute(location)).toBe(false);
  });
});
