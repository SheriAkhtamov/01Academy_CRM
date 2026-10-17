import type { EmployeeIdentity } from '@shared/contracts/employee-identity';
import { apiRequest } from '@/lib/queryClient';

// The /api/users prefix lets existing profile and employee mutations refresh it.
export const employeeIdentitiesQueryKey = ['/api/users', 'identities'] as const;
export const employeeIdentitiesQueryOptions = {
  queryKey: employeeIdentitiesQueryKey,
  queryFn: () => apiRequest('GET', '/api/users/identities') as Promise<EmployeeIdentity[]>,
  staleTime: 60_000,
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
};
