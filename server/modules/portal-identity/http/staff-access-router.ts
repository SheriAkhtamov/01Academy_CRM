import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import {
  portalAccountStatusSchema,
  portalClassificationCommandSchema,
  portalInvitationCreateSchema,
  portalPermissionUpdateSchema,
  portalStaffRecoverySchema,
} from "@shared/contracts/portal-identity";
import type { PortalIdentityService } from "../application/identity-service";
import type { PortalStaffActor } from "../domain/actor-context";
import { PortalError } from "../domain/access-policy";
import { portalContactCheckSchema } from "@shared/contracts/portal-contact-checks";

export const createPortalAccessRouter = ({
  service,
  resolveStaffActor,
  enabled = true,
  canInvite,
  emailEnabledForStudent,
}: {
  service: PortalIdentityService;
  resolveStaffActor: (
    req: Request,
  ) => PortalStaffActor | Promise<PortalStaffActor>;
  enabled?: boolean;
  canInvite?: (studentId: number) => Promise<boolean>;
  emailEnabledForStudent?: (studentId: number) => Promise<boolean>;
}) => {
  const router = Router({ mergeParams: true });
  router.use((_req, res, next) =>
    enabled
      ? next()
      : res
          .status(404)
          .json({ error: "portalUnavailable", code: "portalUnavailable" }),
  );
  const route =
    (
      handler: (
        req: Request,
        res: Response,
        actor: PortalStaffActor,
        studentId: number,
      ) => Promise<unknown>,
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        const actor = await resolveStaffActor(req);
        const studentId = z.coerce
          .number()
          .int()
          .positive()
          .parse(req.params.studentId ?? req.params.id);
        await handler(req, res, actor, studentId);
      } catch (error) {
        if (error instanceof PortalError)
          res
            .status(error.status)
            .json({ error: error.code, code: error.code });
        else if (error instanceof z.ZodError)
          res
            .status(400)
            .json({
              error: "portalInvalidData",
              code: "portalInvalidData",
              fields: error.issues.map((issue) => issue.path.join(".")),
            });
        else next(error);
      }
    };
  router.get(
    "/",
    route(async (_req, res, actor, studentId) =>
      res.json(await service.getStudentAccess(actor, studentId)),
    ),
  );
  router.get(
    "/accounts",
    route(async (req, res, actor, studentId) => {
      const login = z.string().trim().min(4).max(254).parse(req.query.login);
      res.json(await service.lookupAccount(actor, studentId, login));
    }),
  );
  router.post(
    "/contact-matches",
    route(async (req, res, actor, studentId) => res.json(await service.checkContacts(actor, studentId, portalContactCheckSchema.parse(req.body)))),
  );
  router.post(
    "/classification",
    route(async (req, res, actor, studentId) => {
      const command = portalClassificationCommandSchema.parse(req.body);
      res.json(
        await service.classifyStudent(
          actor,
          studentId,
          command.classification,
          command.verificationMethod,
          command.verifiedBirthDate ?? null,
        ),
      );
    }),
  );
  router.post(
    "/invitations",
    route(async (req, res, actor, studentId) => {
      const command = portalInvitationCreateSchema.parse(req.body);
      if (canInvite && !(await canInvite(studentId)))
        throw new PortalError("portalInvitationsDisabled", 403);
      if (
        command.channel === "email" &&
        emailEnabledForStudent &&
        !(await emailEnabledForStudent(studentId))
      )
        throw new PortalError("portalEmailUnavailable", 409);
      res
        .status(201)
        .json(await service.createInvitation(actor, studentId, command));
    }),
  );
  router.post(
    "/links/:linkId/revoke",
    route(async (req, res, actor, studentId) => {
      const linkId = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.params.linkId);
      await service.revokeLink(actor, studentId, linkId);
      res.json({ success: true });
    }),
  );
  router.patch(
    "/links/:linkId/permissions",
    route(async (req, res, actor, studentId) => {
      const linkId = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.params.linkId);
      const command = portalPermissionUpdateSchema.parse(req.body);
      await service.updatePermissions(
        actor,
        studentId,
        linkId,
        command.permissions,
        command.verificationMethod,
        command.verificationBasis,
        Boolean(command.adultConsent),
      );
      res.json(await service.getStudentAccess(actor, studentId));
    }),
  );
  router.post(
    "/accounts/:accountId/status",
    route(async (req, res, actor, studentId) => {
      const accountId = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.params.accountId);
      const command = portalAccountStatusSchema.parse(req.body);
      await service.setAccountStatus(
        actor,
        studentId,
        accountId,
        command.status,
      );
      res.json(await service.getStudentAccess(actor, studentId));
    }),
  );
  router.post(
    "/accounts/:accountId/recovery",
    route(async (req, res, actor, studentId) => {
      const accountId = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.params.accountId);
      const command = portalStaffRecoverySchema.parse(req.body);
      await service.staffReset(
        actor,
        studentId,
        accountId,
        command.password,
        command.verificationMethod,
        command.verificationBasis,
      );
      res.json({ success: true });
    }),
  );
  return router;
};
