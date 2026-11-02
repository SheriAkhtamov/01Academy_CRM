import { useQuery } from '@tanstack/react-query';
import { enrollmentGroupsKey } from './queries';

import type { EnrollmentGroupOption } from './types';
import { groupsApi } from './api';

export function partitionEnrollmentGroups<T extends EnrollmentGroupOption>(groups: T[]) {
  return [
    { labelKey: 'futureGroupsTitle' as const, groups: groups.filter((group) => group.status === 'planned') },
    { labelKey: 'regularGroups' as const, groups: groups.filter((group) => group.status !== 'planned') },
  ].filter((section) => section.groups.length > 0);
}

export function useEnrollmentGroupOptions(fallback: EnrollmentGroupOption[], enabled: boolean) {
  const query = useQuery({
    queryKey: enrollmentGroupsKey,
    queryFn: groupsApi.enrollmentOptions,
    enabled,
  });
  return { ...query, options: query.data ?? fallback };
}
