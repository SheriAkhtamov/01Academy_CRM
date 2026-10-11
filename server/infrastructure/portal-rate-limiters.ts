import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";

export type PortalRateLimitBudgets = {
  windowMs: number;
  readPerAccount: number;
  mutationPerAccount: number;
  readPerIp: number;
  mutationPerIp: number;
  anonymousReadPerIp: number;
  anonymousMutationPerIp: number;
  publicPortfolioReadPerIp: number;
  uploadsPerAccount: number;
  uploadWindowMs: number;
  maxInFlight: number;
  maxInFlightPerIp: number;
};

export const PORTAL_RATE_LIMIT_DEFAULTS: Readonly<PortalRateLimitBudgets> =
  Object.freeze({
    windowMs: 60_000,
    readPerAccount: 1_200,
    mutationPerAccount: 120,
    readPerIp: 120_000,
    mutationPerIp: 12_000,
    anonymousReadPerIp: 300,
    anonymousMutationPerIp: 300,
    publicPortfolioReadPerIp: 1_000,
    uploadsPerAccount: 20,
    uploadWindowMs: 15 * 60_000,
    maxInFlight: 200,
    maxInFlightPerIp: 200,
  });

/** Match realm boundaries, including their roots, without matching staff paths. */
export const isPortalRateLimitRealm = (path: string) =>
  /^\/api\/portal(?:\/|$)/.test(path) ||
  /^\/api\/public\/portfolio(?:\/|$)/.test(path);

const isRead = (request: Request) =>
  ["GET", "HEAD", "OPTIONS"].includes(request.method);
const isMutation = (request: Request) =>
  ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
const accountId = (request: Request) => {
  const id = request.portalSession?.accountId;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
};
const ipKey = (request: Request) =>
  ipKeyGenerator(request.ip || request.socket.remoteAddress || "127.0.0.1");

/** Account middleware must follow createPortalSessionMiddleware's live validation. */
export function createPortalRateLimiters({
  enabled = true,
  limits = {},
}: {
  enabled?: boolean | (() => boolean);
  limits?: Partial<PortalRateLimitBudgets>;
} = {}): {
  edge: RequestHandler;
  account: RequestHandler;
  publicPortfolio: RequestHandler;
} {
  const budgets = { ...PORTAL_RATE_LIMIT_DEFAULTS, ...limits };
  for (const [key, value] of Object.entries(budgets)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
      throw new Error(`Invalid portal rate-limit budget: ${key}`);
  }
  const active = () => (typeof enabled === "function" ? enabled() : enabled);
  const reject: RequestHandler = (_request, response) => {
    const retryAfter = Number(response.getHeader("Retry-After"));
    response.status(429).json({
      error: "portalTooManyRequests",
      code: "portalTooManyRequests",
      retryAfter:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1,
    });
  };
  let inFlight = 0;
  const inFlightByIp = new Map<string, number>();
  const bounded =
    (middleware: RequestHandler): RequestHandler => {
    const admitted = new WeakSet<Request>();
    return (request, response, next) => {
      if (!active()) return next();
      if (admitted.has(request)) return next();
      const key = ipKey(request);
      const current = inFlightByIp.get(key) ?? 0;
      if (
        inFlight >= budgets.maxInFlight ||
        current >= budgets.maxInFlightPerIp
      ) {
        response.setHeader("Retry-After", "1");
        return reject(request, response, next);
      }
      inFlight++;
      admitted.add(request);
      inFlightByIp.set(key, current + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        inFlight--;
        const remaining = (inFlightByIp.get(key) ?? 1) - 1;
        if (remaining > 0) inFlightByIp.set(key, remaining);
        else inFlightByIp.delete(key);
        request.removeListener("aborted", release);
        response.removeListener("finish", release);
        response.removeListener("close", release);
      };
      request.once("aborted", release);
      response.once("finish", release);
      response.once("close", release);
      return middleware(request, response, next);
    };
    };
  const limiter = (
    limit: number,
    keyGenerator: (request: Request) => string,
    windowMs = budgets.windowMs,
  ) =>
    rateLimit({
      windowMs,
      limit,
      keyGenerator,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      skip: () => !active(),
      handler: reject,
    });
  const edgeRead = limiter(budgets.readPerIp, ipKey);
  const edgeMutation = limiter(budgets.mutationPerIp, ipKey);
  const accountKey = (request: Request) =>
    `portal-account:${accountId(request)}`;
  const accountRead = limiter(budgets.readPerAccount, accountKey);
  const accountMutation = limiter(budgets.mutationPerAccount, accountKey);
  const anonymousRead = limiter(budgets.anonymousReadPerIp, ipKey);
  const anonymousMutation = limiter(budgets.anonymousMutationPerIp, ipKey);
  const upload = limiter(
    budgets.uploadsPerAccount,
    accountKey,
    budgets.uploadWindowMs,
  );
  const publicRead = limiter(budgets.publicPortfolioReadPerIp, ipKey);

  return {
    edge: bounded((request, response, next) => {
      if (isRead(request)) return edgeRead(request, response, next);
      if (isMutation(request)) return edgeMutation(request, response, next);
      next();
    }),
    account: (request, response, next) => {
      if (accountId(request) === null) {
        if (isRead(request)) return anonymousRead(request, response, next);
        if (isMutation(request))
          return anonymousMutation(request, response, next);
        return next();
      }
      if (isRead(request)) return accountRead(request, response, next);
      if (!isMutation(request)) return next();
      return accountMutation(request, response, (error) => {
        if (error) return next(error);
        if (
          request.method === "POST" &&
          /^\/api\/portal\/files\/?$/.test(request.originalUrl.split("?")[0])
        )
          return upload(request, response, next);
        next();
      });
    },
    publicPortfolio: bounded((request, response, next) => {
      if (isRead(request)) return publicRead(request, response, next);
      next();
    }),
  };
}
