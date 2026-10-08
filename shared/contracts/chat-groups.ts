import { z } from 'zod';
import { positiveIdSchema, type MessageAttachment } from './messages';

export const createChatGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  participantIds: z.array(positiveIdSchema).min(1).max(99),
}).strict();
export const sendGroupMessageSchema = z.object({ content: z.string().trim().max(10_000).default('') }).strict();
export type CreateChatGroupRequest = z.infer<typeof createChatGroupSchema>;
export type ChatGroupDto = { id: number; name: string; createdBy: number | null; participantCount: number; unreadCount: number };
export type GroupMessageDto = {
  id: number; groupId: number; senderId: number | null; senderName: string;
  content: string; createdAt: string; attachments: MessageAttachment[];
};
