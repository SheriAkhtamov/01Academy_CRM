import type { EnrollmentGroupOption } from './types';
import { apiRequest } from '@/lib/queryClient';

export const groupsApi = {
  enrollmentOptions: () => apiRequest('GET', '/api/academy/enrollment-groups') as Promise<EnrollmentGroupOption[]>,
  archive: <T>(groupId: number) => (
    apiRequest('POST', `/api/academy/groups/${groupId}/archive`) as Promise<T>
  ),
  unarchive: <T>(groupId: number) => (
    apiRequest('POST', `/api/academy/groups/${groupId}/unarchive`) as Promise<T>
  ),
};
