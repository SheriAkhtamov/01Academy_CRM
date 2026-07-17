import { describe, expect, it } from 'vitest';
import { isContainedWorkspaceRoute } from '../client/src/lib/containedWorkspaceRoutes';

describe('isContainedWorkspaceRoute', () => {
  it.each([
    '/sales/pipeline',
    '/sales/pipeline?lead=42',
    '/sales/messages',
    '/sales/task-board',
    '/teacher-workspace/tasks',
    '/marketing-workspace/tasks',
    '/admin/tasks',
  ])('keeps the app shell from adding a second scrollbar for %s', (location) => {
    expect(isContainedWorkspaceRoute(location)).toBe(true);
  });

  it.each([
    '/sales',
    '/sales/tasks',
    '/sales/archive',
    '/marketing-workspace/funnel',
    '/admin',
  ])('preserves normal page scrolling for %s', (location) => {
    expect(isContainedWorkspaceRoute(location)).toBe(false);
  });
});
