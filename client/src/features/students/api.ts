import { apiRequest } from '@/lib/queryClient';

export const studentsApi = {
  updateStatus: <T>(studentId: number, status: string, exitReason?: string) => (
    apiRequest('PATCH', `/api/academy/students/${studentId}/status`, { status, exitReason }) as Promise<T>
  ),
  addGroup: <T>(studentId: number, groupId: number, isPrimary?: boolean) => (
    apiRequest('POST', `/api/academy/students/${studentId}/groups`, { groupId, isPrimary }) as Promise<T>
  ),
  removeGroup: <T>(studentId: number, groupId: number) => (
    apiRequest('DELETE', `/api/academy/students/${studentId}/groups/${groupId}`) as Promise<T>
  ),
};
