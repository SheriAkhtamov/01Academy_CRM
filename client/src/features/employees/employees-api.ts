import { apiRequest } from '@/lib/queryClient';

export const createEmployee = (data: unknown) => apiRequest('POST', '/api/users', data);

export const updateEmployee = (id: number, data: unknown) => (
  apiRequest('PUT', `/api/users/${id}`, data)
);

export const deleteEmployee = (id: number, leadTransferManagerId?: number) => {
  const params = new URLSearchParams();
  if (leadTransferManagerId) params.set('leadTransferManagerId', String(leadTransferManagerId));
  const query = params.toString();
  return apiRequest('DELETE', `/api/users/${id}${query ? `?${query}` : ''}`);
};

export const archiveEmployee = (id: number, leadTransferManagerId?: number) => (
  apiRequest('POST', `/api/users/${id}/archive`, leadTransferManagerId ? { leadTransferManagerId } : {})
);

export const restoreEmployee = (id: number) => apiRequest('POST', `/api/users/${id}/restore`, {});

export const resetEmployeePassword = (id: number) => (
  apiRequest('POST', `/api/users/${id}/reset-password`)
);

export const updateEmployeeCredentials = (id: number, data: unknown) => (
  apiRequest('PATCH', `/api/users/${id}/credentials`, data)
);

export const getEmployeeCredentials = (id: number) => (
  apiRequest('GET', `/api/users/${id}/credentials`)
);

export const getEmployeeResponsibilityImpact = (id: number) => (
  apiRequest('GET', `/api/users/${id}/sales-lead-count`)
);
