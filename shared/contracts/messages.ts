import { z } from 'zod';

export const positiveIdSchema = z.coerce.number().int().positive();

export const sendMessageRequestSchema = z.object({
  receiverId: positiveIdSchema,
  content: z.string().trim().min(1).max(10_000),
}).strict();

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export type MessageDto = {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  isRead: boolean | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type ConversationUserDto = {
  id: number;
  fullName: string;
  position?: string | null;
  isOnline?: boolean | null;
  lastSeenAt?: string | null;
};
