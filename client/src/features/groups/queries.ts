import type { QueryClient } from '@tanstack/react-query';

export const enrollmentGroupsKey = ['/api/academy/enrollment-groups'] as const;

export const groupCodeCatalogueKey = ['/api/academy/group-code-catalogue'] as const;
export const groupConfigurationKey = ['/api/academy/group-configuration'] as const;

export const invalidateGroupData = (client: QueryClient) => Promise.all([
  groupConfigurationKey,
  enrollmentGroupsKey,
  groupCodeCatalogueKey,
  ['/api/academy/configuration'],
  ['/api/academy/groups'],
  ...['sales', 'marketing', 'teacher', 'administration'].map((module) => [`/api/academy/modules/${module}`]),
].map((queryKey) => client.invalidateQueries({ queryKey })));
