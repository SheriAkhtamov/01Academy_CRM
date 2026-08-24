import type {
  ArchiveLeadRequest,
  AssignLeadRequest,
  BulkAssignLeadsRequest,
  BulkArchiveLeadsRequest,
  BulkDeleteLeadsRequest,
  BulkUpdateLeadStatusRequest,
  CreateAcademyLeadRequest,
  CreateLeadStudentRequest,
  LeadCommentRequest,
  LeadTagRequest,
  LeadSocialAccountDeleteRequest,
  LeadSocialAccountRequest,
  MergeLeadDraftRequest,
  MergeLeadIds,
  RestoreLeadRequest,
  UpdateAcademyLeadRequest,
} from '@shared/contracts/academy-leads';
import { apiRequest } from '@/lib/queryClient';

export type LeadIdentifier = number;

export type LeadViewState = {
  leadId: number;
  firstViewedAt: string | null;
  firstViewedBy: number | null;
};

export type UnviewedLeadCount = { count: number };

export const leadsApi = {
  create: (input: CreateAcademyLeadRequest) => (
    apiRequest('POST', '/api/academy/leads', input)
  ),
  getById: <T>(leadId: LeadIdentifier) => (
    apiRequest('GET', `/api/academy/leads/${leadId}`) as Promise<T>
  ),
  update: <T>(leadId: LeadIdentifier, input: UpdateAcademyLeadRequest) => (
    apiRequest('PATCH', `/api/academy/leads/${leadId}`, input) as Promise<T>
  ),
  assign: <T>(leadId: LeadIdentifier, input: AssignLeadRequest) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/assign`, input) as Promise<T>
  ),
  bulkAssign: <T>(input: BulkAssignLeadsRequest) => (
    apiRequest('POST', '/api/academy/leads/bulk-assign', input) as Promise<T>
  ),
  bulkUpdateStatus: <T>(input: BulkUpdateLeadStatusRequest) => (
    apiRequest('POST', '/api/academy/leads/bulk-status', input) as Promise<T>
  ),
  bulkDelete: <T>(input: BulkDeleteLeadsRequest) => (
    apiRequest('POST', '/api/academy/leads/bulk-delete', input) as Promise<T>
  ),
  bulkArchive: <T>(input: BulkArchiveLeadsRequest) => (
    apiRequest('POST', '/api/academy/leads/bulk-archive', input) as Promise<T>
  ),
  archive: <T>(leadId: LeadIdentifier, input: ArchiveLeadRequest) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/archive`, input) as Promise<T>
  ),
  restore: <T>(leadId: LeadIdentifier, input: RestoreLeadRequest) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/restore`, input) as Promise<T>
  ),
  merge: <T>(input: MergeLeadIds) => (
    apiRequest('POST', '/api/academy/leads/merge', input) as Promise<T>
  ),
  mergeDraft: <T>(input: MergeLeadDraftRequest) => (
    apiRequest('POST', '/api/academy/leads/merge-draft', input) as Promise<T>
  ),
  searchMergeCandidates: <T>(search: string) => (
    apiRequest(
      'GET',
      `/api/academy/leads/merge-candidates?q=${encodeURIComponent(search)}`,
    ) as Promise<T>
  ),
  getMergePreview: <T>(firstLeadId: number, secondLeadId: number) => (
    apiRequest(
      'GET',
      `/api/academy/leads/merge-preview?firstLeadId=${firstLeadId}&secondLeadId=${secondLeadId}`,
    ) as Promise<T>
  ),
  addTag: <T>(leadId: number, input: LeadTagRequest) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/tags`, input) as Promise<T>
  ),
  removeTag: <T>(leadId: number, assignmentId: number) => (
    apiRequest('DELETE', `/api/academy/leads/${leadId}/tags/${assignmentId}`) as Promise<T>
  ),
  addSocialAccount: <T>(leadId: number, input: LeadSocialAccountRequest) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/social-accounts`, input) as Promise<T>
  ),
  updateSocialAccount: <T>(
    leadId: number,
    accountId: number,
    input: LeadSocialAccountRequest,
  ) => (
    apiRequest('PATCH', `/api/academy/leads/${leadId}/social-accounts/${accountId}`, input) as Promise<T>
  ),
  removeSocialAccount: <T>(
    leadId: number,
    accountId: number,
    input: LeadSocialAccountDeleteRequest = {},
  ) => (
    apiRequest('DELETE', `/api/academy/leads/${leadId}/social-accounts/${accountId}`, input) as Promise<T>
  ),
  addComment: <T>(leadId: number, input: LeadCommentRequest) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/comments`, input) as Promise<T>
  ),
  createStudent: <T>(leadId: number, input: CreateLeadStudentRequest) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/students`, input) as Promise<T>
  ),
  markViewed: (leadId: LeadIdentifier) => (
    apiRequest('POST', `/api/academy/leads/${leadId}/view`) as Promise<LeadViewState>
  ),
  getUnviewedCount: () => (
    apiRequest('GET', '/api/academy/leads/unviewed-count') as Promise<UnviewedLeadCount>
  ),
};

export const leadQueryKeys = {
  all: ['/api/academy/leads'] as const,
  detail: (leadId: number | null) => ['/api/academy/leads', leadId] as const,
  tags: ['/api/academy/lead-tags'] as const,
  unviewedCount: ['/api/academy/leads/unviewed-count'] as const,
  mergeCandidates: (search: string) => ['/api/academy/leads/merge-candidates', search] as const,
  mergePreview: (firstLeadId?: number, secondLeadId?: number) => (
    ['/api/academy/leads/merge-preview', firstLeadId, secondLeadId] as const
  ),
};

// Leads arrive from Instagram, Meta forms, and calls without a page reload, so
// the badge polls on the same cadence as the missed-call counter.
export const unviewedLeadCountQueryOptions = {
  queryKey: leadQueryKeys.unviewedCount,
  queryFn: leadsApi.getUnviewedCount,
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
};
