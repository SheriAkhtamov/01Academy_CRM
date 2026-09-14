import { z } from 'zod';

const recipientIdsSchema = z.array(z.number().int().positive())
  .min(1)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length);

const broadcastContentSchema = z.string().trim().min(1).max(10_000);

export const employeeBroadcastRequestSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('notification'),
    recipientIds: recipientIdsSchema,
    title: z.string().trim().min(1).max(255),
    content: broadcastContentSchema,
  }).strict(),
  z.object({
    channel: z.literal('message'),
    recipientIds: recipientIdsSchema,
    content: broadcastContentSchema,
  }).strict(),
]);

export type EmployeeBroadcastRequest = z.infer<typeof employeeBroadcastRequestSchema>;

export type EmployeeBroadcastResult = {
  channel: EmployeeBroadcastRequest['channel'];
  sentCount: number;
};
