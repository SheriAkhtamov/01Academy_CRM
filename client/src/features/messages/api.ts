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
  send: (message: SendMessageRequest) => (
    apiRequest('POST', '/api/messages', message) as Promise<MessageDto>
  ),
};
