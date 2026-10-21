import type { LessonStaff } from '@shared/contracts/lesson-staff';
import { apiRequest } from '@/lib/queryClient';

const lessonUrl = (lessonId: number) => `/api/academy/lessons/${lessonId}`;
export const lessonStaffQueryKey = (lessonId: number) => ['/api/academy/lessons', lessonId, 'staff'] as const;
export const lessonStaffApi = {
  get: (lessonId: number): Promise<LessonStaff> => apiRequest('GET', `${lessonUrl(lessonId)}/staff`),
  add: (lessonId: number, teacherId: number): Promise<LessonStaff> => apiRequest('POST', `${lessonUrl(lessonId)}/assistants`, { teacherId }),
  remove: (lessonId: number, teacherId: number): Promise<LessonStaff> => apiRequest('DELETE', `${lessonUrl(lessonId)}/assistants/${teacherId}`),
};
