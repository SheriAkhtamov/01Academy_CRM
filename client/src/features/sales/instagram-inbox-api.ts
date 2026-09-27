import { apiRequest } from '@/lib/queryClient';

export const instagramInboxUnreadQueryOptions = {
  queryKey: ['/api/instagram/conversations', 'unread-count'] as const,
  queryFn: () => apiRequest('GET', '/api/instagram/conversations/unread-count') as Promise<{ count: number }>,
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
};
