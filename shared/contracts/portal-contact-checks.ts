import { z } from "zod";

export const portalContactCheckSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
}).strict();
export type PortalContactCheck = z.infer<typeof portalContactCheckSchema>;
export const portalContactMatchSchema = z.object({
  id: z.number().int().positive(), login: z.string(), fullName: z.string(),
  status: z.enum(["pending", "active", "suspended"]),
  matchedBy: z.array(z.enum(["email", "phone"])).min(1), canUse: z.boolean(),
});
export type PortalContactMatch = z.infer<typeof portalContactMatchSchema>;
export const portalContactMatchesSchema = z.object({
  items: z.array(portalContactMatchSchema).max(10), additionalMatches: z.boolean(),
});
export type PortalContactMatches = z.infer<typeof portalContactMatchesSchema>;
