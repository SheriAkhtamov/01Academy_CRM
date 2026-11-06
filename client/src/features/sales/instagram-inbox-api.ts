import { apiRequest } from '@/lib/queryClient';

export const instagramInboxUnreadQueryOptions = {
  queryKey: ['/api/instagram/conversations', 'unread-count'] as const,
  queryFn: () => apiRequest('GET', '/api/instagram/conversations/unread-count') as Promise<{ count: number }>,
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
};

export interface QuickReplyItem {
  id: number;
  text: string;
  language: string;
  createdBy?: number | null;
  createdAt: string;
}

export const fetchQuickReplies = async (language: string): Promise<QuickReplyItem[]> =>
  apiRequest('GET', `/api/instagram/quick-replies?language=${language}`);

export const createQuickReplyApi = async (text: string, language: string): Promise<QuickReplyItem> =>
  apiRequest('POST', '/api/instagram/quick-replies', { text, language });

export const deleteQuickReplyApi = async (id: number): Promise<{ success: boolean }> =>
  apiRequest('DELETE', `/api/instagram/quick-replies/${id}`);

export const fetchInstagramSyncStatus = async () =>
  apiRequest('GET', '/api/instagram/conversations/sync/status');

export const syncInstagramConversations = async () =>
  apiRequest('POST', '/api/instagram/conversations/sync');

export const fetchInstagramMessages = async (conversationId: number) =>
  apiRequest('GET', `/api/instagram/conversations/${conversationId}/messages`);

export const markInstagramConversationReadApi = async (conversationId: number, lastReadMessageId: number) =>
  apiRequest('POST', `/api/instagram/conversations/${conversationId}/read`, { lastReadMessageId });

export const sendInstagramTextMessageApi = async (conversationId: number, content: string) =>
  apiRequest('POST', `/api/instagram/conversations/${conversationId}/messages`, { content });

export const sendInstagramMediaMessageApi = async (conversationId: number, file: File) => {
  const formData = new FormData();
  formData.append('files', file);
  const res = await fetch(`/api/instagram/conversations/${conversationId}/media`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw Object.assign(new Error(errorData.error || 'instagramSendFailed'), { status: res.status });
  }
  return res.json();
};

export const linkInstagramLeadApi = async (conversationId: number, targetLeadId: number) =>
  apiRequest('POST', `/api/instagram/conversations/${conversationId}/link-lead`, { targetLeadId });

export interface InstagramSuggestedLead {
  leadId: number;
  contactName: string;
  phone: string;
}

export const fetchInstagramSuggestedLead = async (conversationId: number): Promise<InstagramSuggestedLead | null> =>
  apiRequest('GET', `/api/instagram/conversations/${conversationId}/suggested-lead`);

export const searchLeadsForInstagramApi = async (query: string): Promise<{ id: number; contactName: string; phone: string | null }[]> =>
  apiRequest('GET', `/api/academy/leads?q=${encodeURIComponent(query.trim())}`);
