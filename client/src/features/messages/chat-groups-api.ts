import { apiRequest } from '@/lib/queryClient';
import type { ChatGroupDetailsDto, ChatGroupDto, GroupMessageDto, CreateChatGroupRequest, LeaveChatGroupRequest } from '@shared/contracts/chat-groups';

export const chatGroupKeys = {
  all: ['/api/chat-groups'] as const,
  detail: (id: number) => ['/api/chat-groups', id, 'details'] as const,
  messages: (id: number) => ['/api/chat-groups', id, 'messages'] as const,
};
export const chatGroupsApi = {
  list: (): Promise<ChatGroupDto[]> => apiRequest('GET', '/api/chat-groups'),
  create: (input: CreateChatGroupRequest): Promise<ChatGroupDto> => apiRequest('POST', '/api/chat-groups', input),
  detail: (id: number): Promise<ChatGroupDetailsDto> => apiRequest('GET', `/api/chat-groups/${id}`),
  rename: (id: number, name: string) => apiRequest('PATCH', `/api/chat-groups/${id}`, { name }),
  addParticipants: (id: number, participantIds: number[]) => apiRequest('POST', `/api/chat-groups/${id}/participants`, { participantIds }),
  removeParticipant: (id: number, participantId: number) => apiRequest('DELETE', `/api/chat-groups/${id}/participants/${participantId}`),
  leave: (id: number, input: LeaveChatGroupRequest = {}) => apiRequest('POST', `/api/chat-groups/${id}/leave`, input),
  messages: (id: number): Promise<GroupMessageDto[]> => apiRequest('GET', `/api/chat-groups/${id}/messages`),
  read: (id: number, messageId: number) => apiRequest('PUT', `/api/chat-groups/${id}/read`, { messageId }),
  send: (id: number, content: string, files: File[]): Promise<GroupMessageDto> => {
    if (files.length === 0) return apiRequest('POST', `/api/chat-groups/${id}/messages`, { content });
    const form = new FormData();
    form.append('content', content);
    files.forEach((file) => form.append('files', file));
    return apiRequest('POST', `/api/chat-groups/${id}/messages`, form);
  },
};
export const chatGroupQueryOptions = { queryKey: chatGroupKeys.all, queryFn: chatGroupsApi.list, staleTime: 10_000, refetchInterval: 30_000, refetchOnWindowFocus: true };
