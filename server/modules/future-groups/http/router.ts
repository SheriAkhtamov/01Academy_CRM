import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  futureGroupInputSchema,
  futureGroupPartySchema,
} from "@shared/contracts/future-groups";
import { actorContextFromRequest } from "../../leads/http/actor-context";
import {
  getHttpErrorStatus,
  getPublicErrorMessage,
} from "../../../lib/http-errors";
import type { FutureGroupsService } from "../application/service";
import { logger } from "../../../lib/logger";

const id = z.coerce.number().int().positive();
const params = z.object({ id });

export function createFutureGroupsRouter(service: FutureGroupsService) {
  const router = Router();
  const run =
    (handler: (req: Request) => Promise<unknown>, status = 200, fallback = "failedToLoadData") =>
    async (req: Request, res: Response) => {
      try {
        res.status(status).json(await handler(req));
      } catch (error) {
        if (error instanceof z.ZodError)
          return res.status(400).json({ error: "invalidData" });
        const errorStatus = getHttpErrorStatus(error);
        if (errorStatus >= 500) {
          logger.error("Future group request failed", {
            error, method: req.method, route: req.route.path, groupId: req.params.id,
          });
        }
        res
          .status(errorStatus)
          .json({ error: getPublicErrorMessage(error, fallback) });
      }
    };
  router.get(
    "/future-groups",
    run((req) => service.list(actorContextFromRequest(req))),
  );
  router.get(
    "/future-groups/candidates",
    run((req) =>
      service.candidates(
        actorContextFromRequest(req),
        z
          .string()
          .max(100)
          .parse(req.query.q ?? ""),
      ),
    ),
  );
  router.post(
    "/future-groups",
    run(
      (req) =>
        service.save(
          actorContextFromRequest(req),
          futureGroupInputSchema.parse(req.body),
        ),
      201,
      "futureGroupSaveFailed",
    ),
  );
  router.patch(
    "/future-groups/:id",
    run((req) =>
      service.save(
        actorContextFromRequest(req),
        futureGroupInputSchema.parse(req.body),
        params.parse(req.params).id,
      ),
      200,
      "futureGroupSaveFailed",
    ),
  );
  router.get(
    "/future-groups/:id/members",
    run((req) =>
      service.members(
        actorContextFromRequest(req),
        params.parse(req.params).id,
      ),
    ),
  );
  router.post(
    "/future-groups/:id/members",
    run(
      (req) =>
        service.changeMember(
          actorContextFromRequest(req),
          params.parse(req.params).id,
          futureGroupPartySchema.parse(req.body),
          false,
        ),
      201,
    ),
  );
  router.delete(
    "/future-groups/:id/members/:kind/:partyId",
    run((req) =>
      service.changeMember(
        actorContextFromRequest(req),
        params.parse(req.params).id,
        futureGroupPartySchema.parse({
          kind: req.params.kind,
          id: id.parse(req.params.partyId),
        }),
        true,
      ),
    ),
  );
  router.post(
    "/future-groups/:id/archive",
    run((req) =>
      service.archive(
        actorContextFromRequest(req),
        params.parse(req.params).id,
      ),
    ),
  );
  return router;
}
