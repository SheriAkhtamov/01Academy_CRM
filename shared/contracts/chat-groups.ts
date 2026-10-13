import { z } from 'zod';
import { positiveIdSchema, type MessageAttachment } from './messages';

export const createChatGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  participantIds: z.array(positiveIdSchema).min(1).max(99),
}).strict();
export const sendGroupMessageSchema = z.object({ content: z.string().trim().max(10_000).default('') }).strict();
export const renameChatGroupSchema = createChatGroupSchema.pick({ name: true }).strict();
export const addChatGroupParticipantsSchema = createChatGroupSchema.pick({ participantIds: true }).strict();
export const updateChatGroupProfileSchema = renameChatGroupSchema.extend({ removePhoto: z.boolean().optional() }).strict();
export const leaveChatGroupSchema = z.object({ nextOwnerId: positiveIdSchema.optional() }).strict();
export type CreateChatGroupRequest = z.infer<typeof createChatGroupSchema>;
export type RenameChatGroupRequest = z.infer<typeof renameChatGroupSchema>;
export type AddChatGroupParticipantsRequest = z.infer<typeof addChatGroupParticipantsSchema>;
export type LeaveChatGroupRequest = z.infer<typeof leaveChatGroupSchema>;
export type ChatGroupDto = { id: number; name: string; avatarUrl?: string | null; createdBy: number | null; participantCount: number; unreadCount: number };
export type ChatGroupParticipantDto = {
  id: number; fullName: string; avatarUrl: string | null; position: string | null; isActive: boolean; isArchived: boolean;
};
export type ChatGroupDetailsDto = ChatGroupDto & { participants: ChatGroupParticipantDto[]; canManage: boolean };
export type GroupMessageDto = {
  id: number; groupId: number; senderId: number | null; senderName: string;
  senderAvatarUrl?: string | null;
  content: string; createdAt: string; attachments: MessageAttachment[];
};
