import type { ChatGroupDetailsDto, ChatGroupDto, CreateChatGroupRequest, GroupMessageDto } from '@shared/contracts/chat-groups';
import type { MessageAttachment } from '@shared/contracts/messages';

export interface ChatGroupRepository {
  detail(groupId: number, userId: number, administrator: boolean): Promise<ChatGroupDetailsDto | null>;
  updateProfile(groupId: number, userId: number, administrator: boolean, input: { name: string; avatarUrl?: string | null }): Promise<{ audienceUserIds: number[]; previousAvatarUrl: string | null }>;
  rename(groupId: number, userId: number, administrator: boolean, name: string): Promise<number[]>;
  addParticipants(groupId: number, userId: number, administrator: boolean, participantIds: number[]): Promise<number[]>;
  removeParticipant(groupId: number, userId: number, administrator: boolean, participantId: number): Promise<number[]>;
  leave(groupId: number, userId: number, nextOwnerId?: number): Promise<number[]>;
  list(userId: number): Promise<ChatGroupDto[]>;
  create(userId: number, input: CreateChatGroupRequest): Promise<ChatGroupDto>;
  memberIds(groupId: number, userId: number): Promise<number[] | null>;
  messages(groupId: number): Promise<GroupMessageDto[]>;
  send(groupId: number, senderId: number, content: string, attachments: MessageAttachment[]): Promise<GroupMessageDto>;
  markRead(groupId: number, userId: number, messageId: number): Promise<void>;
  attachment(fileId: string, userId: number): Promise<MessageAttachment | null>;
}
