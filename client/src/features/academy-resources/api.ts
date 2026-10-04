import { apiRequest } from '@/lib/queryClient';

export interface School {
  id: number;
  name: string;
  code: string;
  address: string;
  timezone: string;
  isActive: boolean;
  isArchived?: boolean;
}

export interface Room {
  id: number;
  schoolId: number;
  name: string;
  capacity: number;
  isActive: boolean;
  isArchived?: boolean;
}

export const schoolArchiveApi = {
  archive: (id: number) => apiRequest('POST', `/api/academy/schools/${id}/archive`),
  restore: (id: number) => apiRequest('POST', `/api/academy/schools/${id}/unarchive`),
};
