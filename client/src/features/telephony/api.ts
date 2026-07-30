import { apiRequest } from '@/lib/queryClient';

export type MissedCallUnreadSummary = {
  count: number;
};

export const telephonyQueryKeys = {
  missedCallUnread: ['/api/telephony/calls/missed/unread'] as const,
};

export const telephonyApi = {
  getMissedCallUnread: () => (
    apiRequest('GET', '/api/telephony/calls/missed/unread') as Promise<MissedCallUnreadSummary>
  ),
  markMissedCallsRead: () => (
    apiRequest('PUT', '/api/telephony/calls/missed/read') as Promise<
      MissedCallUnreadSummary & { lastSeenCallId: number }
    >
  ),
};

export const missedCallUnreadQueryOptions = {
  queryKey: telephonyQueryKeys.missedCallUnread,
  queryFn: telephonyApi.getMissedCallUnread,
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
};
