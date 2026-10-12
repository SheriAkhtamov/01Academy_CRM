import { apiRequest } from '@/lib/queryClient';
import type { PlatformUpdate, PublishUpdateCommand } from '@shared/contracts/platform-updates';

export const updateQueryKeys = {
  all: ['/api/updates'] as const,
  list: ['/api/updates', 'feed'] as const,
  detail: (id: number) => ['/api/updates', 'post', id] as const,
};
export const updatesApi = {
  list: (): Promise<PlatformUpdate[]> => apiRequest('GET', '/api/updates'),
  find: (id: number): Promise<PlatformUpdate> => apiRequest('GET', `/api/updates/${id}`),
  publish: (command: PublishUpdateCommand): Promise<PlatformUpdate> => apiRequest('POST', '/api/updates', command),
};
