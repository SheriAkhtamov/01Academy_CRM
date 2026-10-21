import { expect, it } from 'vitest';
import type { SanitizedUser } from '../shared/auth';
import { notificationDestination } from '../client/src/lib/notificationDestination';

const user = { id: 1, module: 'sales', modules: ['sales'] } as SanitizedUser;
it('opens the related lead, student and task while respecting module access', () => {
  const base = { id: 3, title: 'Event', message: null, isRead: false, relatedEntityId: 42 };
  expect(notificationDestination({ ...base, relatedEntityType: 'lead' }, user)).toBe('/sales/pipeline?lead=42');
  expect(notificationDestination({ ...base, relatedEntityType: 'student' }, user)).toBe('/sales?student=42');
  expect(notificationDestination({ ...base, relatedEntityType: 'task' }, user)).toBe('/tasks?task=42');
  expect(notificationDestination({ ...base, relatedEntityType: 'user' }, user)).toBeNull();
  expect(notificationDestination({ ...base, relatedEntityType: 'lead' }, { ...user, module: 'teacher', modules: ['teacher'] })).toBeNull();
  expect(notificationDestination({ ...base, relatedEntityType: 'lead', relatedEntityId: -1 }, user)).toBeNull();
});

it('preserves the task namespace for legacy academy notifications', () => {
  const notification = { id: 1, title: 'Escalation', isRead: false, message: null, relatedEntityId: 55 };
  expect(notificationDestination({ ...notification, relatedEntityType: 'academy_task' }, user)).toBe('/tasks?academyTask=55');
  expect(notificationDestination({ ...notification, relatedEntityType: 'board_task' }, user)).toBe('/tasks?task=55');
});

it('opens a published update for employees in every module', () => {
  const notification = { id: 1, title: 'New update', message: null, isRead: false, relatedEntityType: 'platform_update', relatedEntityId: 25 };
  for (const module of ['sales', 'teacher', 'marketing', 'finance', 'administration']) {
    expect(notificationDestination(notification, { ...user, module, modules: [module] } as SanitizedUser)).toBe('/updates?post=25');
  }
  expect(notificationDestination(notification, null)).toBeNull();
});
