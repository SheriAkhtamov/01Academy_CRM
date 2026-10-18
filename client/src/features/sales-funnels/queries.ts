import { useQuery } from '@tanstack/react-query';
import { salesFunnelsApi } from './api';

export const salesFunnelQueryKeys = {
  transferOptions: ['/api/academy/sales-funnels', 'transfer-options'] as const,
};

export const useFunnelTransferOptions = (enabled: boolean) => useQuery({
  queryKey: salesFunnelQueryKeys.transferOptions,
  queryFn: salesFunnelsApi.transferOptions,
  enabled,
  staleTime: 0,
});
