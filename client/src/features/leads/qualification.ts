import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadQualification, LeadQualificationRequest, RevokeLeadQualificationRequest } from '@shared/contracts/lead-qualification';
import { leadsApi } from './api';
import { salesQueryKeys } from '@/features/sales/queries';

export const qualificationKey = (leadId: number, funnelId: number) => ['/api/academy/leads', leadId, 'qualification', funnelId] as const;

export function useLeadQualification(leadId: number, funnelId: number) {
  const client = useQueryClient();
  const queryKey = qualificationKey(leadId, funnelId);
  const query = useQuery({ queryKey, staleTime: 0, refetchOnWindowFocus: true, queryFn: () => leadsApi.getQualification(leadId) });
  const mutation = useMutation({
    mutationFn: (input: LeadQualificationRequest | RevokeLeadQualificationRequest) => leadsApi.setQualification(leadId, input),
    onMutate: () => client.cancelQueries({ queryKey }),
    onError: (error: { status?: number }) => {
      if ([403, 404, 409].includes(Number(error.status))) void client.invalidateQueries({ queryKey });
    },
    onSuccess: (data: LeadQualification) => {
      client.setQueryData(qualificationKey(leadId, data.funnelId), data);
      return client.invalidateQueries({ queryKey: salesQueryKeys.metrics });
    },
  });
  return { query, mutation };
}
