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

export interface Course {
  id: number;
  name: string;
  slug: string;
  ageCategory: string;
  description?: string | null;
  basePriceUzs: number;
  isActive: boolean;
  isArchived?: boolean;
}

export const schoolArchiveApi = {
  archive: (id: number) => apiRequest('POST', `/api/academy/schools/${id}/archive`),
  restore: (id: number) => apiRequest('POST', `/api/academy/schools/${id}/unarchive`),
};

export const roomArchiveApi = {
  archive: (id: number) => apiRequest('POST', `/api/academy/rooms/${id}/archive`),
  restore: (id: number) => apiRequest('POST', `/api/academy/rooms/${id}/unarchive`),
};
export const courseArchiveApi = {
  archive: (id: number) => apiRequest('POST', `/api/academy/courses/${id}/archive`),
  restore: (id: number) => apiRequest('POST', `/api/academy/courses/${id}/unarchive`),
};
