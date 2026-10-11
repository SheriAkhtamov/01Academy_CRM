import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { portalDeliveryKindSchema, portalDeliveryQuerySchema, portalDeliveryRetrySchema } from "@shared/contracts/portal-delivery-management";
import type { PortalStaffActor } from "../../portal-identity/domain/actor-context";
import { PortalError } from "../../portal-identity/domain/access-policy";
import type { PortalDeliveryManagement } from "../application/delivery-management";

export function createPortalDeliveryManagementRouter({ service, resolveStaffActor }: {
  service: PortalDeliveryManagement;
  resolveStaffActor: (request: Request) => PortalStaffActor | Promise<PortalStaffActor>;
}) {
  const router = Router();
  const route = (work: (request: Request, actor: PortalStaffActor) => Promise<unknown>): RequestHandler => async (request, response, next) => {
    try {
      const actor = await resolveStaffActor(request);
      if (!actor.canManageAccess || !actor.modules.includes("administration")) throw new PortalError("portalAccessDenied", 403);
      response.setHeader("Cache-Control", "private, no-store");
      response.json(await work(request, actor));
    } catch (error) {
      if (error instanceof PortalError) response.status(error.status).json({ code: error.code, error: error.code });
      else if (error instanceof z.ZodError) response.status(400).json({ code: "portalInvalidData", error: "portalInvalidData" });
      else next(error);
    }
  };
  router.get("/delivery-failures", route((request, actor) => service.list(actor, portalDeliveryQuerySchema.parse(request.query))));
  router.post("/delivery-failures/:kind/:id/retry", route((request, actor) => service.retry(actor,
    portalDeliveryKindSchema.parse(request.params.kind), z.coerce.number().int().positive().parse(request.params.id), portalDeliveryRetrySchema.parse(request.body))));
  return router;
}
