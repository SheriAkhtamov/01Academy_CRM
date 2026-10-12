import type { QueryClient } from '@tanstack/react-query';

export const groupConfigurationKey = ['/api/academy/group-configuration'] as const;

export const invalidateGroupData = (client: QueryClient) => Promise.all([
  groupConfigurationKey,
  ['/api/academy/configuration'],
  ['/api/academy/groups'],
  ...['sales', 'marketing', 'teacher', 'administration'].map((module) => [`/api/academy/modules/${module}`]),
].map((queryKey) => client.invalidateQueries({ queryKey })));
