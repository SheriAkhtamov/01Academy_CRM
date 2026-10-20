import type { StudentContract, StudentContractList, StudentContractListQuery } from '@shared/contracts/student-contracts';
import { apiRequest } from '@/lib/queryClient';

const contractUrl = (contractId: string) => `/api/academy/student-contracts/${encodeURIComponent(contractId)}`;

export const studentContractsApi = {
  list: (query: StudentContractListQuery) => {
    const parameters = new URLSearchParams({ q: query.q, page: String(query.page), pageSize: String(query.pageSize) });
    return apiRequest('GET', `/api/academy/student-contracts?${parameters}`) as Promise<StudentContractList>;
  },
  forStudent: (studentId: number) => (
    apiRequest('GET', `/api/academy/students/${studentId}/contract`) as Promise<StudentContract | null>
  ),
  get: (contractId: string) => (
    apiRequest('GET', contractUrl(contractId)) as Promise<StudentContract>
  ),
  create: (studentId: number) => (
    apiRequest('POST', `/api/academy/students/${studentId}/contract`, {}) as Promise<StudentContract>
  ),
  createDraft: (leadId: number) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/contract-drafts`, {}) as Promise<StudentContract>
  ),
  changeNumber: (contractId: string, number: string, version: number) => (
    apiRequest('PATCH', contractUrl(contractId), { number, version }) as Promise<StudentContract>
  ),
  regenerate: (contractId: string, version: number) => (
    apiRequest('POST', `${contractUrl(contractId)}/regenerate`, { version }) as Promise<StudentContract>
  ),
  uploadFile: (contractId: string, file: File, version: number) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', String(version));
    return apiRequest('POST', `${contractUrl(contractId)}/file`, formData) as Promise<StudentContract>;
  },
  cancel: async (contractId: string, version: number) => {
    await apiRequest('DELETE', contractUrl(contractId), { version });
  },
};
