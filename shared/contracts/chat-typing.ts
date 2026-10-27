import { z } from 'zod';

export const CHAT_TYPING_REFRESH_MS = 2_000;
export const CHAT_TYPING_IDLE_MS = 3_000;
export const CHAT_TYPING_TTL_MS = 6_000;

export const chatTypingRequestSchema = z.object({
  active: z.boolean(),
  sourceId: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const chatTypingEventSchema = chatTypingRequestSchema.extend({
  kind: z.enum(['direct', 'group']),
  targetId: z.number().int().positive(),
  senderId: z.number().int().positive(),
}).strict();

export type ChatTypingRequest = z.infer<typeof chatTypingRequestSchema>;
export type ChatTypingEvent = z.infer<typeof chatTypingEventSchema>;
export type ChatTypingKind = ChatTypingEvent['kind'];
