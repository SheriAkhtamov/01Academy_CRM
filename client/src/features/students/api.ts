import { apiRequest } from '@/lib/queryClient';
import type { StudentProfile, StudentProject } from '@shared/contracts/student-profile';
import { uploadStudentProject } from './project-upload';
import type { StudentExpectedPaymentRequest } from '@shared/contracts/academy-leads';

export const studentsApi = {
  profile: (studentId: number, context: 'sales' | 'teacher' = 'sales') => apiRequest('GET', `/api/academy/students/${studentId}/profile${context === 'teacher' ? '?context=teacher' : ''}`) as Promise<StudentProfile>,
  addProject: (studentId: number, input: { title: string; url?: string; file?: File }, onProgress: (percent: number) => void) => input.file
    ? uploadStudentProject(studentId, input.title, input.file, onProgress)
    : apiRequest('POST', `/api/academy/students/${studentId}/projects`, { title: input.title, url: input.url }) as Promise<StudentProject>,
  updateDetails: <T>(studentId: number, input: {
    studentName: string;
    studentAge: number | null;
    phone: string | null;
  } & StudentExpectedPaymentRequest) => (
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
