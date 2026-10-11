import { z } from "zod";

export const PORTAL_REALTIME_PATH = "/api/portal/ws";
export const PORTAL_REALTIME_PROTOCOL = "portal.v1";
export const PORTAL_REALTIME_CSRF_PREFIX = "csrf.";
export const portalRealtimeEventSchema = z
  .object({
    type: z.literal("portal.refresh"),
    linkId: z.number().int().positive().optional(),
    serverTime: z.string().datetime(),
  })
  .strict();
export type PortalRealtimeEvent = z.infer<typeof portalRealtimeEventSchema>;
