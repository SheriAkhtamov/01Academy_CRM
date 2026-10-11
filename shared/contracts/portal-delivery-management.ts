import { z } from "zod";
export const portalDeliveryKindSchema = z.enum(["identity", "resource"]);
export type PortalDeliveryKind = z.infer<typeof portalDeliveryKindSchema>;
export const portalDeliveryQuerySchema = z.object({
  kind: z.enum(["all", "identity", "resource"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).max(256).optional(),
}).strict();
export type PortalDeliveryQuery = z.infer<typeof portalDeliveryQuerySchema>;
export const portalDeliveryFailureSchema = z.object({
  id: z.number().int().positive(), kind: portalDeliveryKindSchema,
  account: z.object({ id: z.number().int().positive(), login: z.string(), fullName: z.string() }),
  recipient: z.string(), template: z.enum(["invitation", "recovery", "email_change", "email_changed", "notification"]),
  createdAt: z.string().datetime({ offset: true }),
  reason: z.enum(["delivery_failed", "delivery_interrupted"]),
  canRetry: z.boolean(), version: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PortalDeliveryFailure = z.infer<typeof portalDeliveryFailureSchema>;
export const portalDeliveryPageSchema = z.object({
  items: z.array(portalDeliveryFailureSchema), nextCursor: z.string().nullable(), hasMore: z.boolean(),
});
export type PortalDeliveryPage = z.infer<typeof portalDeliveryPageSchema>;
export const portalDeliveryRetrySchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey: z.string().uuid(),
}).strict();
export type PortalDeliveryRetry = z.infer<typeof portalDeliveryRetrySchema>;
export const portalDeliveryRetryResultSchema = z.object({ queued: z.literal(true), replayed: z.boolean() });
export type PortalDeliveryRetryResult = z.infer<typeof portalDeliveryRetryResultSchema>;
