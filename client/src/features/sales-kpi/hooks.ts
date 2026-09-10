import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompanyTargets, saveCompanyTargets, getKpiLeadOwnership, getKpiOverview, getKpiPlans, claimKpiLead, recordKpiOffer, reviewKpiPayment, saveKpiRules } from './api';
import type { KpiSaleReview } from '@shared/sales-kpi';
import { invalidateSalesLeadData } from '@/features/sales/queries';

export const KPI_QUERY_KEY = ['/api/academy/sales-kpi'] as const;
export const useCompanyTargets = () => useQuery({ queryKey: ['/api/academy/company-settings'], queryFn: getCompanyTargets });
export const useSaveCompanyTargets = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: saveCompanyTargets, onSuccess: () => Promise.all([
    client.invalidateQueries({ queryKey: ['/api/academy/company-settings'] }),
    client.invalidateQueries({ queryKey: ['/api/academy/modules/administration'] }),
  ]) });
};
export const useKpiPlans = () => useQuery({ queryKey: [...KPI_QUERY_KEY, 'plans'], queryFn: getKpiPlans });
export const useKpiOverview = (month: string, managerId: number | null) => useQuery({
  queryKey: [...KPI_QUERY_KEY, 'overview', month, managerId],
  queryFn: () => getKpiOverview(month, managerId),
  refetchInterval: 60_000,
});
export const useSaveKpiRules = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: saveKpiRules,
    onSuccess: () => client.invalidateQueries({ queryKey: KPI_QUERY_KEY }) });
};
export const useReviewKpiPayment = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: number; input: KpiSaleReview }) => reviewKpiPayment(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: KPI_QUERY_KEY }) });
};
export const useKpiLead = (leadId: number) => useQuery({
  queryKey: [...KPI_QUERY_KEY, 'lead', leadId], queryFn: () => getKpiLeadOwnership(leadId), enabled: leadId > 0,
});
export const useRecordKpiOffer = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: recordKpiOffer,
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: KPI_QUERY_KEY }),
      client.invalidateQueries({ queryKey: ['/api/academy/leads'] }),
    ]),
  });
};
export const useClaimKpiLead = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: claimKpiLead,
    onSuccess: () => invalidateSalesLeadData(client),
  });
};
