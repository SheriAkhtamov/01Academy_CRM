import { MAX_STUDENT_CONTRACT_BYTES, type StudentContract, type StudentContractList, type StudentContractListQuery } from '@shared/contracts/student-contracts';
import { apiRequest, throwIfResNotOk } from '@/lib/queryClient';

const contractUrl = (contractId: string) => `/api/academy/student-contracts/${encodeURIComponent(contractId)}`;

export const studentContractsApi = {
  fileBlob: async (contractId: string, signal: AbortSignal): Promise<Blob> => {
    const response = await fetch(`${contractUrl(contractId)}/file`, {
      credentials: 'same-origin', cache: 'no-store', signal,
    });
    await throwIfResNotOk(response);
    if (Number(response.headers.get('Content-Length')) > MAX_STUDENT_CONTRACT_BYTES) throw new Error('studentContractFileTooLarge');
    const blob = await response.blob();
    if (blob.size > MAX_STUDENT_CONTRACT_BYTES) throw new Error('studentContractFileTooLarge');
    if (!blob.size) throw new Error('studentContractFileRequired');
    return blob;
  },
  list: (query: StudentContractListQuery) => {
    const parameters = new URLSearchParams({ q: query.q, status: query.status, page: String(query.page), pageSize: String(query.pageSize) });
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
