import type {
  ConversationUserDto,
  MessageDto,
  SendMessageRequest,
} from '@shared/contracts/messages';
import { apiRequest } from '@/lib/queryClient';

export const messageQueryKeys = {
  conversations: ['/api/messages/conversations'] as const,
  onlineUsers: ['/api/users/online-status'] as const,
  thread: (participantId: number) => ['/api/messages', participantId] as const,
};

export const messagesApi = {
  getConversations: () => (
    apiRequest('GET', '/api/messages/conversations') as Promise<ConversationUserDto[]>
  ),
  getOnlineUsers: () => (
    apiRequest('GET', '/api/users/online-status') as Promise<ConversationUserDto[]>
  ),
  getThread: (participantId: number) => (
    apiRequest('GET', `/api/messages/${participantId}`) as Promise<MessageDto[]>
  ),
  markConversationRead: (participantId: number) => (
    apiRequest('PUT', `/api/messages/conversations/${participantId}/read`) as Promise<{
      updated: number;
      messageIds: number[];
    }>
  ),
  send: (message: SendMessageRequest & { files?: File[] }) => {
    if (!message.files?.length) return apiRequest('POST', '/api/messages', {
      receiverId: message.receiverId, content: message.content,
    }) as Promise<MessageDto>;
    const form = new FormData();
    form.append('receiverId', String(message.receiverId));
    form.append('content', message.content);
    message.files.forEach((file) => form.append('files', file));
    return apiRequest('POST', '/api/messages', form) as Promise<MessageDto>;
  },
};

export const conversationQueryOptions = {
  queryKey: messageQueryKeys.conversations,
  queryFn: messagesApi.getConversations,
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
};

export const totalUnreadMessages = (
  conversations: readonly ConversationUserDto[],
): number => conversations.reduce(
  (total, conversation) => total + Math.max(0, Number(conversation.unreadCount) || 0),
  0,
);
