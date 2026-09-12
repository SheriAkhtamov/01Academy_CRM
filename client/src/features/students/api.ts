import { apiRequest } from '@/lib/queryClient';

export const studentsApi = {
  updateDetails: <T>(studentId: number, input: {
    studentName: string;
    studentAge: number | null;
    phone: string | null;
  }) => (
    apiRequest('PATCH', `/api/academy/students/${studentId}`, input) as Promise<T>
  ),
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
