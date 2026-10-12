import type { AcademyPortalQuery, AcademyPortalPage, AcademyPortalLeadRole, AcademyPortalCredentialChange, AcademyPortalCredentialResult } from '@shared/contracts/academy-portal-access';
import { translations, type TranslationKey } from '@/lib/i18n';
import { apiRequest } from '@/lib/queryClient';

export const academyPortalKey = ['academy-portal-access'] as const;
export const academyPortalApi = {
  directory: (query: AcademyPortalQuery): Promise<AcademyPortalPage> => apiRequest('GET', `/api/lms-management/academy-access?${new URLSearchParams({ q: query.q, page: String(query.page), pageSize: String(query.pageSize) })}`),
  role: (leadId: number, command: AcademyPortalLeadRole): Promise<AcademyPortalCredentialResult> => apiRequest('POST', `/api/lms-management/academy-access/leads/${leadId}/role`, command),
  show: (leadId: number, accountId: number, version: number): Promise<AcademyPortalCredentialResult> => apiRequest('POST', `/api/lms-management/academy-access/leads/${leadId}/accounts/${accountId}/credentials/show`, { version }),
  change: (leadId: number, accountId: number, command: AcademyPortalCredentialChange): Promise<AcademyPortalCredentialResult> => apiRequest('PATCH', `/api/lms-management/academy-access/leads/${leadId}/accounts/${accountId}/credentials`, command),
};
export function academyPortalError(error: unknown): TranslationKey {
  const message = error instanceof Error ? error.message : '';
  let code = message;
  const objectStart = message.indexOf('{');
  if (objectStart >= 0) {
    try { const payload = JSON.parse(message.slice(objectStart)); code = payload.code ?? payload.error ?? ''; } catch { code = ''; }
  }
  return code in translations ? code as TranslationKey : 'lmsStaffSaveFailed';
}
