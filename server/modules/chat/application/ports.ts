import type { ChatGroupDto, CreateChatGroupRequest, GroupMessageDto } from '@shared/contracts/chat-groups';
import type { MessageAttachment } from '@shared/contracts/messages';

export interface ChatGroupRepository {
  list(userId: number): Promise<ChatGroupDto[]>;
  create(userId: number, input: CreateChatGroupRequest): Promise<ChatGroupDto>;
  memberIds(groupId: number, userId: number): Promise<number[] | null>;
  messages(groupId: number): Promise<GroupMessageDto[]>;
  send(groupId: number, senderId: number, content: string, attachments: MessageAttachment[]): Promise<GroupMessageDto>;
  markRead(groupId: number, userId: number, messageId: number): Promise<void>;
  attachment(fileId: string, userId: number): Promise<MessageAttachment | null>;
}
