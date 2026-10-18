import type { QueryClient } from '@tanstack/react-query';
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
