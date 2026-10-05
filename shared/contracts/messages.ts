import { z } from 'zod';

export const positiveIdSchema = z.coerce.number().int().positive();
export const MAX_MESSAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_FILES = 5;
export type MessageAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
};

export const sendMessageRequestSchema = z.object({
  receiverId: positiveIdSchema,
  content: z.string().trim().max(10_000).default(''),
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
  attachments?: MessageAttachment[];
};

export type ConversationUserDto = {
  id: number;
  fullName: string;
  avatarUrl?: string | null;
  position?: string | null;
  isOnline?: boolean | null;
  lastSeenAt?: string | null;
  unreadCount?: number;
};
