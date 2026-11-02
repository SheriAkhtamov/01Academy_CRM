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

const id = z.coerce.number().int().positive();
const params = z.object({ id });

export function createFutureGroupsRouter(service: FutureGroupsService) {
  const router = Router();
  const run =
    (handler: (req: Request) => Promise<unknown>, status = 200) =>
    async (req: Request, res: Response) => {
      try {
        res.status(status).json(await handler(req));
      } catch (error) {
        if (error instanceof z.ZodError)
          return res.status(400).json({ error: "invalidData" });
        res
          .status(getHttpErrorStatus(error))
          .json({ error: getPublicErrorMessage(error, "failedToLoadData") });
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
