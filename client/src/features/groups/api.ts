import type { EnrollmentGroupOption } from './types';
import { apiRequest } from '@/lib/queryClient';

export const groupsApi = {
  enrollmentOptions: async (): Promise<EnrollmentGroupOption[]> => {
    const response: unknown = await apiRequest('GET', '/api/academy/enrollment-groups');
    if (!Array.isArray(response) || !response.every(group => group && Number.isInteger(group.id) && group.id > 0 && typeof group.name === 'string')) {
      throw new Error('failedToLoadData');
    }
    return response;
  },
  archive: <T>(groupId: number) => (
    apiRequest('POST', `/api/academy/groups/${groupId}/archive`) as Promise<T>
  ),
  unarchive: <T>(groupId: number) => (
    apiRequest('POST', `/api/academy/groups/${groupId}/unarchive`) as Promise<T>
  ),
};
