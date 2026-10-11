import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import {
  portalChildCredentialsSchema,
  portalConsentSchema,
  portalEmailChangeSchema,
  portalEmailVerifySchema,
  portalInvitationAcceptSchema,
  portalLoginCommandSchema,
  portalPasswordChangeSchema,
  portalProfileUpdateSchema,
  portalReauthenticateSchema,
  portalRecoveryCompleteSchema,
  portalRecoveryRequestSchema,
} from "@shared/contracts/portal-identity";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import type { PortalIdentityService } from "../application/identity-service";
import { PortalError } from "../domain/access-policy";

const wrap =
  (
    handler: (req: Request, res: Response) => Promise<unknown>,
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof PortalError) {
        if (error.retryAfter)
          res.setHeader("Retry-After", String(error.retryAfter));
        res
          .status(error.status)
          .json({
            error: error.code,
            code: error.code,
            retryAfter: error.retryAfter,
          });
      } else if (error instanceof z.ZodError)
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
const sessionId = (req: Request) => {
  if (!req.portalSession?.accountId)
    throw new PortalError("portalAuthenticationRequired", 401);
  return req.portalSession.id;
};
const positiveId = (value: string) =>
  z.coerce.number().int().positive().parse(value);
export const createPortalIdentityRouter = ({
  service,
  enabled = true,
}: {
  service: PortalIdentityService;
  enabled?: boolean;
}) => {
  const router = Router();
  router.use((_req, res, next) =>
    enabled
      ? next()
      : res
          .status(404)
          .json({ error: "portalUnavailable", code: "portalUnavailable" }),
  );
  // The composition root mounts portal session and CSRF middleware before all portal routers.
  router.get(
    "/auth/session",
    wrap(async (req, res) => {
      const session =
        req.portalSession ?? (await service.createAnonymousSession());
      if (!req.portalSession) req.portalSessionCookies?.set(session);
      res.json(await service.getSessionDto(session));
    }),
  );
  router.post(
    "/auth/login",
    wrap(async (req, res) => {
      const command = portalLoginCommandSchema.parse(req.body);
      const session = await service.login(
        command.identifier,
        command.password,
        req.ip ?? "unknown",
        req.portalSession?.id,
        req.requestId,
      );
      req.portalSessionCookies?.set(session);
      res.json(await service.getSessionDto(session));
    }),
  );
  router.post(
    "/auth/logout",
    wrap(async (req, res) => {
      if (req.portalSession) await service.logout(req.portalSession.id);
      req.portalSessionCookies?.clear();
      res.json({ success: true });
    }),
  );
  router.post(
    "/auth/invitations/accept",
    wrap(async (req, res) => {
      const command = portalInvitationAcceptSchema.parse(req.body);
      const session = await service.acceptInvitation(
        command.token,
        command.password,
        command.fullName,
        req.portalSession ?? null,
        req.requestId,
      );
      req.portalSessionCookies?.set(session);
      res.json(await service.getSessionDto(session));
    }),
  );
  router.post(
    "/auth/recovery/request",
    wrap(async (req, res) => {
      const command = portalRecoveryRequestSchema.parse(req.body);
      await service.requestRecovery(command.identifier, req.ip ?? "unknown");
      res.json({ success: true });
    }),
  );
  router.post(
    "/auth/recovery/complete",
    wrap(async (req, res) => {
      const command = portalRecoveryCompleteSchema.parse(req.body);
      await service.completeRecovery(command.token, command.password, req.requestId);
      req.portalSessionCookies?.clear();
      res.json({ success: true });
    }),
  );
  router.get(
    "/subjects",
    wrap(async (req, res) => {
      sessionId(req);
      res.json(await service.listSubjects(req.portalSession!.accountId!));
    }),
  );
  router.get(
    "/me",
    wrap(async (req, res) => {
      sessionId(req);
      res.json((await service.getSessionDto(req.portalSession!)).account);
    }),
  );
  router.patch(
    "/me",
    wrap(async (req, res) =>
      res.json(
        await service.updateProfile(
          sessionId(req),
          portalProfileUpdateSchema.parse(req.body),
        ),
      ),
    ),
  );
  router.post(
    "/me/reauthenticate",
    wrap(async (req, res) => {
      const command = portalReauthenticateSchema.parse(req.body);
      await service.reauthenticate(sessionId(req), command.password);
      res.json({ success: true });
    }),
  );
  router.post(
    "/me/password",
    wrap(async (req, res) => {
      const command = portalPasswordChangeSchema.parse(req.body);
      const session = await service.changePassword(
        sessionId(req),
        command.password,
        command.newPassword,
        req.requestId,
      );
      req.portalSessionCookies?.set(session);
      res.json(await service.getSessionDto(session));
    }),
  );
  router.get(
    "/me/sessions",
    wrap(async (req, res) =>
      res.json(await service.getSessions(sessionId(req))),
    ),
  );
  router.post(
    "/me/sessions/revoke",
    wrap(async (req, res) => {
      const command = z
        .object({ sessionId: z.string().min(32).max(64).optional() })
        .strict()
        .parse(req.body);
      await service.revokeSessions(sessionId(req), command.sessionId);
      if (command.sessionId === req.portalSession?.id)
        req.portalSessionCookies?.clear();
      res.json({ success: true });
    }),
  );
  router.post(
    "/subjects/:linkId/credentials",
    wrap(async (req, res) => {
      const command = portalChildCredentialsSchema.parse(req.body);
      await service.childCredentials(
        sessionId(req),
        positiveId(req.params.linkId),
        command.password,
        command.login,
        req.requestId,
      );
      res.json({ success: true });
    }),
  );
  router.get(
    "/me/representatives",
    wrap(async (req, res) =>
      res.json(await service.ownRepresentatives(sessionId(req))),
    ),
  );
  router.post(
    "/me/representatives/consent",
    wrap(async (req, res) => {
      const command = portalConsentSchema.parse(req.body);
      await service.representativeConsent(
        sessionId(req),
        command.linkId,
        command.permissions,
        command.approved,
        req.requestId,
      );
      res.json({ success: true });
    }),
  );
  router.post(
    "/me/email",
    wrap(async (req, res) => {
      const command = portalEmailChangeSchema.parse(req.body);
      await service.requestEmailChange(sessionId(req), command.email);
      res.json({ success: true });
    }),
  );
  router.post(
    "/me/email/verify",
    wrap(async (req, res) => {
      const command = portalEmailVerifySchema.parse(req.body);
      const session = await service.verifyEmail(sessionId(req), command.token, req.requestId);
      req.portalSessionCookies?.set(session);
      res.json(await service.getSessionDto(session));
    }),
  );
  return router;
};
export const requirePortalActor =
  (
    service: PortalIdentityService,
    permission: PortalPermission,
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      await service.resolveActor(
        sessionId(req),
        positiveId(req.params.linkId),
        permission,
      );
      next();
    } catch (error) {
      if (error instanceof PortalError)
        res.status(error.status).json({ error: error.code, code: error.code });
      else next(error);
    }
  };
