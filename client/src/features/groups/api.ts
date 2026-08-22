import { apiRequest } from '@/lib/queryClient';

export const groupsApi = {
  archive: <T>(groupId: number) => (
    apiRequest('POST', `/api/academy/groups/${groupId}/archive`) as Promise<T>
  ),
  unarchive: <T>(groupId: number) => (
    apiRequest('POST', `/api/academy/groups/${groupId}/unarchive`) as Promise<T>
  ),
};
