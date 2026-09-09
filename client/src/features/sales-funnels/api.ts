import { apiRequest } from '@/lib/queryClient';

export interface SalesFunnel {
  id: number;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  leadCount: number;
  integrationCount: number;
  integrations: string[];
}

export type SalesFunnelInput = {
  name: string;
  isActive: boolean;
  isDefault: boolean;
  integrations: string[];
};

export const salesFunnelsApi = {
  create: (input: SalesFunnelInput) => apiRequest('POST', '/api/academy/sales-funnels', input),
  update: (funnelId: number, input: SalesFunnelInput) => (
    apiRequest('PATCH', `/api/academy/sales-funnels/${funnelId}`, input)
  ),
  delete: (funnelId: number) => apiRequest('DELETE', `/api/academy/sales-funnels/${funnelId}`),
  transferAndDelete: (funnelId: number, targetFunnelId: number) => (
    apiRequest('POST', `/api/academy/sales-funnels/${funnelId}/transfer-and-delete`, { targetFunnelId })
  ),
};
