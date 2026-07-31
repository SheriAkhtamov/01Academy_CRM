import type { QueryClient } from '@tanstack/react-query';
import { invalidateLeadData } from '../leads/queries';

export const salesQueryKeys = {
  module: ['/api/academy/modules/sales'] as const,
  metrics: ['/api/academy/modules/sales/metrics'] as const,
};

export const invalidateSalesData = (queryClient: QueryClient) => Promise.all([
  queryClient.invalidateQueries({ queryKey: salesQueryKeys.module }),
  queryClient.invalidateQueries({ queryKey: salesQueryKeys.metrics }),
]);

export const invalidateSalesLeadData = (
  queryClient: QueryClient,
  leadId?: number | null,
) => Promise.all([
  invalidateSalesData(queryClient),
  invalidateLeadData(queryClient, leadId),
]);
