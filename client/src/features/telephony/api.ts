import { apiRequest } from '@/lib/queryClient';
import type { TelephonyCallStatus } from '@/lib/telephony';

export type MissedCallUnreadSummary = {
  count: number;
  lastSeenCallId: number;
};

export type CallHistoryItem = {
  id: number;
  clientCallId: string | null;
  providerCallId: string | null;
  direction: 'incoming' | 'outgoing';
  status: TelephonyCallStatus;
  phone: string;
  contactType: 'lead' | 'student' | null;
  contactId: number | null;
  contactName: string | null;
  leadId: number | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  talkSeconds: number;
  hangupCause: string | null;
  note: string | null;
  hasRecording: boolean;
};

export type TelephonyExtension = {
  id: number;
  name: string;
  extension: string;
};

export type TelephonyContactMatch = {
  type: 'lead' | 'student';
  id: number;
  leadId: number | null;
  name: string;
  secondaryName: string | null;
  phone: string;
};

export const telephonyQueryKeys = {
  missedCallUnread: ['/api/telephony/calls/missed/unread'] as const,
  calls: ['/api/telephony/calls'] as const,
  extensions: ['/api/telephony/extensions'] as const,
  journalOperators: ['/api/telephony/calls/journal/operators'] as const,
  contactLookup: (phone: string) => ['/api/telephony/contacts/lookup', phone] as const,
};

export const telephonyApi = {
  getMissedCallUnread: () => (
    apiRequest('GET', '/api/telephony/calls/missed/unread') as Promise<MissedCallUnreadSummary>
  ),
  markMissedCallsRead: () => (
    apiRequest('PUT', '/api/telephony/calls/missed/read') as Promise<MissedCallUnreadSummary>
  ),
  getCalls: (limit = 50) => (
    apiRequest('GET', `/api/telephony/calls?limit=${limit}`) as Promise<CallHistoryItem[]>
  ),
  getExtensions: () => (
    apiRequest('GET', '/api/telephony/extensions') as Promise<TelephonyExtension[]>
  ),
  getJournalOperators: () => (
    apiRequest('GET', '/api/telephony/calls/journal/operators') as Promise<TelephonyExtension[]>
  ),
  getRecordingUrl: (callId: number) => (
    apiRequest('GET', `/api/telephony/calls/${callId}/recording`) as Promise<{ url: string }>
  ),
  saveCallNote: (callId: number, note: string | null) => (
    apiRequest('PUT', `/api/telephony/calls/${callId}/note`, { note }) as Promise<{
      id: number;
      note: string | null;
    }>
  ),
  lookupContact: (phone: string) => (
    apiRequest(
      'GET',
      `/api/telephony/contacts/lookup?phone=${encodeURIComponent(phone)}`,
    ) as Promise<{ phone: string; contact: TelephonyContactMatch | null }>
  ),
};

/**
 * The journal's employee picker. The roster changes about as often as staff do,
 * so it is fetched once and left alone while the manager pages through calls.
 */
export const journalOperatorsQueryOptions = {
  queryKey: telephonyQueryKeys.journalOperators,
  queryFn: telephonyApi.getJournalOperators,
  staleTime: 5 * 60_000,
};

export const missedCallUnreadQueryOptions = {
  queryKey: telephonyQueryKeys.missedCallUnread,
  queryFn: telephonyApi.getMissedCallUnread,
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
};
