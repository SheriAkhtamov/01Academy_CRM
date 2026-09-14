import type { LeadDistributionSettings } from '@shared/contracts/lead-distribution';
import { apiRequest } from '@/lib/queryClient';

export const leadDistributionQueryKey = ['/api/academy/sales-lead-distribution'] as const;

export const leadDistributionApi = {
  get: () => (
    apiRequest('GET', '/api/academy/sales-lead-distribution') as Promise<LeadDistributionSettings>
  ),
  update: (enabled: boolean) => (
    apiRequest('PATCH', '/api/academy/sales-lead-distribution', { enabled }) as Promise<LeadDistributionSettings>
  ),
};
