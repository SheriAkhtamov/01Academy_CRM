import { describe, expect, it } from 'vitest';
import { isContainedModuleRoute } from '../client/src/lib/containedModuleRoutes';

describe('isContainedModuleRoute', () => {
  it.each([
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
    // Four setting cards: the page scrolls as a document rather than building
    // an inner window inside a frozen viewport.
    '/integrations',
  ])('preserves normal page scrolling for %s', (location) => {
    expect(isContainedModuleRoute(location)).toBe(false);
  });

  // `/` renders the operator's own module, so it has to follow that module's
  // layout: a teacher signing in must not get a different padding, width and
  // scroll owner on `/` than on `/teacher-module`, which is the same page.
  it('treats the home route as contained only for the teacher module', () => {
    expect(isContainedModuleRoute('/', 'teacher')).toBe(true);
    expect(isContainedModuleRoute('/', 'sales')).toBe(false);
    expect(isContainedModuleRoute('/', 'marketing')).toBe(false);
    expect(isContainedModuleRoute('/', 'administration')).toBe(false);
    expect(isContainedModuleRoute('/', undefined)).toBe(false);
  });

  it('ignores the module on every route that names its own module', () => {
    expect(isContainedModuleRoute('/sales/pipeline', 'teacher')).toBe(true);
    expect(isContainedModuleRoute('/sales', 'teacher')).toBe(false);
  });
});
