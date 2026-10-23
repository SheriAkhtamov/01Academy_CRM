import type { SalesReportScope } from '@shared/contracts/sales-report';
import { getSalesActivityReport } from './api';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { invalidateLeadData, type LeadInvalidationOptions } from '../leads/queries';

export const salesQueryKeys = {
  module: ['/api/academy/modules/sales'] as const,
  metrics: ['/api/academy/modules/sales/metrics'] as const,
  demoStudents: ['/api/academy/modules/sales/demo-students'] as const,
};

export const invalidateSalesData = (queryClient: QueryClient) => Promise.all([
  queryClient.invalidateQueries({ queryKey: salesQueryKeys.module }),
  queryClient.invalidateQueries({ queryKey: salesQueryKeys.metrics }),
  queryClient.invalidateQueries({ queryKey: salesQueryKeys.demoStudents }),
]);

export const invalidateSalesLeadData = (
  queryClient: QueryClient,
  leadId?: number | null,
  options?: LeadInvalidationOptions,
) => Promise.all([
  invalidateSalesData(queryClient),
  invalidateLeadData(queryClient, leadId, options),
  queryClient.invalidateQueries({ queryKey: ['/api/academy/sales-kpi'] }),
  queryClient.invalidateQueries({ queryKey: ['/api/academy/sales-funnels'] }),
]);

export const useSalesActivityReport = (scope: SalesReportScope) => useQuery({
  queryKey: [...salesQueryKeys.metrics, scope],
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
  queryFn: () => {
    const params = new URLSearchParams({ from: scope.from, to: scope.to });
    if (scope.managerId !== null) params.set('managerId', String(scope.managerId));
    if (scope.funnelId !== null) params.set('funnelId', String(scope.funnelId));
    return getSalesActivityReport(params.toString());
  },
});
