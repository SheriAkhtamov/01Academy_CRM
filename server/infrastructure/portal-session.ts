import crypto from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { PortalIdentityService } from "../modules/portal-identity/application/identity-service";
import type { PortalSession } from "../modules/portal-identity/application/ports";

export const PORTAL_COOKIE_NAME = "academy.portal.sid";
export type PortalSessionCookies = {
  set: (session: PortalSession) => void;
  clear: () => void;
};
declare module "express-serve-static-core" {
  interface Request {
    portalSession?: PortalSession;
    portalSessionCookies?: PortalSessionCookies;
  }
}
const readCookie = (cookieHeader: string | undefined) => {
  const cookie = cookieHeader
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${PORTAL_COOKIE_NAME}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(PORTAL_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
};
export const readPortalSessionId = (cookieHeader: string | undefined, secret: string): string | null => {
  const value = readCookie(cookieHeader);
  if (!value || secret.length < 32) return null;
  const [id, sig, ...extra] = value.split('.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(id ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(sig ?? '') || extra.length) return null;
  const expected = crypto.createHmac('sha256', secret).update(id).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
};
export const createPortalSessionMiddleware = ({
  secret,
  secure,
  service,
}: {
  secret: string;
  secure: boolean;
  service: PortalIdentityService;
}): RequestHandler => {
  if (secret.length < 32)
    throw new Error("portal.sessionSecret must contain at least 32 characters");
  const signature = (value: string) =>
    crypto.createHmac("sha256", secret).update(value).digest("base64url");
  const options = {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
  };
  return async (req: Request, res: Response, next) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      req.portalSessionCookies = {
        set: (session) => {
          req.portalSession = session;
          res.cookie(
            PORTAL_COOKIE_NAME,
            `${session.id}.${signature(session.id)}`,
            {
              ...options,
              maxAge: Math.min(
                24 * 60 * 60 * 1000,
                Math.max(0, session.absoluteExpiresAt - Date.now()),
              ),
            },
          );
        },
        clear: () => {
          req.portalSession = undefined;
          res.clearCookie(PORTAL_COOKIE_NAME, options);
        },
      };
      const value = readCookie(req.headers.cookie);
      if (value) {
        const id = readPortalSessionId(req.headers.cookie, secret);
        if (id) {
          const session = await service.resolveSession(id);
          if (session) req.portalSessionCookies.set(session);
          else req.portalSessionCookies.clear();
        } else req.portalSessionCookies.clear();
      }
      if (
        !req.portalSession &&
        req.method === "GET" &&
        (req.path === "/auth/session" ||
          req.path.endsWith("/api/portal/auth/session"))
      )
        req.portalSessionCookies.set(await service.createAnonymousSession());
      next();
    } catch (error) {
      next(error);
    }
  };
};
export const portalCsrfProtection: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const token = req.get("x-portal-csrf");
  const expected = req.portalSession?.csrfToken;
  if (
    !token ||
    !expected ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    token.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  )
    return res
      .status(403)
      .json({ error: "portalCsrfRequired", code: "portalCsrfRequired" });
  next();
};
