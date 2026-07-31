import { useQuery, type QueryClient } from '@tanstack/react-query';
import { leadQueryKeys, leadsApi } from './api';

export const useLeadDetailsQuery = <T>(leadId: number | null, enabled: boolean) => useQuery<T>({
  queryKey: leadQueryKeys.detail(leadId),
  queryFn: () => leadsApi.getById<T>(leadId!),
  enabled: enabled && leadId !== null,
});

export const useLeadMergeCandidatesQuery = <T>(search: string, enabled: boolean) => useQuery<T>({
  queryKey: leadQueryKeys.mergeCandidates(search),
  queryFn: () => leadsApi.searchMergeCandidates<T>(search),
  enabled: enabled && search.length >= 2,
});

export const useLeadMergePreviewQuery = <T>(
  firstLeadId: number | undefined,
  secondLeadId: number | undefined,
) => useQuery<T>({
  queryKey: leadQueryKeys.mergePreview(firstLeadId, secondLeadId),
  queryFn: () => leadsApi.getMergePreview<T>(firstLeadId!, secondLeadId!),
  enabled: Boolean(firstLeadId && secondLeadId && firstLeadId !== secondLeadId),
});

export const invalidateLeadData = (
  queryClient: QueryClient,
  leadId?: number | null,
) => Promise.all([
  queryClient.invalidateQueries({ queryKey: leadQueryKeys.all }),
  queryClient.invalidateQueries({ queryKey: leadQueryKeys.tags }),
  ...(leadId
    ? [queryClient.invalidateQueries({ queryKey: leadQueryKeys.detail(leadId) })]
    : []),
]);
