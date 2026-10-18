import { apiRequest } from '@/lib/queryClient';
import type { SalesFunnelRole } from '@shared/sales-funnel-workflow';
import type { SalesFunnelTransferOption } from '@shared/contracts/sales-funnels';

export interface SalesFunnel {
  id: number;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  initialStageCode?: string;
  workflowRole?: SalesFunnelRole | null;
  isPreferred?: boolean;
  leadCount: number;
  employeeCount: number;
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
  transferOptions: (): Promise<SalesFunnelTransferOption[]> => (
    apiRequest('GET', '/api/academy/sales-funnels/transfer-options')
  ),
  create: (input: SalesFunnelInput) => apiRequest('POST', '/api/academy/sales-funnels', input),
  update: (funnelId: number, input: SalesFunnelInput) => (
    apiRequest('PATCH', `/api/academy/sales-funnels/${funnelId}`, input)
  ),
  delete: (funnelId: number) => apiRequest('DELETE', `/api/academy/sales-funnels/${funnelId}`),
  transferAndDelete: (funnelId: number, targetFunnelId: number) => (
    apiRequest('POST', `/api/academy/sales-funnels/${funnelId}/transfer-and-delete`, { targetFunnelId })
  ),
};
